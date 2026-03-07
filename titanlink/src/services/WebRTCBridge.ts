/**
 * WebRTC Bridge - Allows UDP host to serve video to WebRTC clients
 * 
 * When the host is using the native UDP protocol (Windows) but a client
 * connects using WebRTC (Mac/Linux), this bridge creates an RTCPeerConnection
 * server-side to forward hardware-encoded H.264 frames over a WebRTC DataChannel.
 * It also captures the screen via Electron's desktopCapturer and sends it as
 * a MediaStream track for the WebRTC client to render.
 *
 * Flow:
 *   1. UDP host detects client join via polling
 *   2. Bridge starts polling for WebRTC signaling messages from the client
 *   3. When client sends signaling (SDP offer request), bridge creates offer
 *   4. SDP exchange happens over the REST signaling server
 *   5. Once connected, host's screen capture is streamed via MediaStream track
 *   6. Hardware-encoded frames are also sent via DataChannel (for WebCodecs path)
 */

import { CONFIG } from '../config';
import { decodeGamepadInput, GAMEPAD_PACKET_SIZE } from '../../shared/types/ipc';
import { WebSocketSignalingClient } from './SignalingClient';

const SIGNALING_BASE = CONFIG.RELAY.SIGNALING_HTTP_BASE;

// ICE servers for the bridge connection
const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Free public TURN fallback
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export interface BridgeSettings {
    fps?: number;
    bitrate?: number;
    resolution?: string;
}

export class WebRTCBridge {
    private peerConnection: RTCPeerConnection | null = null;
    private videoChannel: RTCDataChannel | null = null;
    private inputChannel: RTCDataChannel | null = null;
    private mediaStream: MediaStream | null = null;
    private sessionCode: string;
    private hostId: string;
    private clientPeerId: string = '';
    private wsClient: WebSocketSignalingClient | null = null;
    private isActive: boolean = false;
    private settings: BridgeSettings;

    // Callbacks
    private onInputReceived?: (input: any) => void;

    constructor(sessionCode: string, hostId: string, settings: BridgeSettings = {}) {
        this.sessionCode = sessionCode;
        this.hostId = hostId;
        this.settings = settings;
    }

    /**
     * Start the bridge for a specific client peer
     */
    async start(clientPeerId: string, displayId: string, onInput?: (input: any) => void): Promise<void> {
        this.clientPeerId = clientPeerId;
        this.onInputReceived = onInput;
        this.isActive = true;

        console.log(`[WebRTCBridge] Starting bridge for client: ${clientPeerId}`);

        // Capture screen via Electron's desktopCapturer (for MediaStream track)
        await this.captureScreen(displayId);

        // Fetch dynamic ICE servers if available
        let iceServers = ICE_SERVERS;
        try {
            if (window.electronAPI?.turn?.getIceServers) {
                const servers = await window.electronAPI.turn.getIceServers();
                if (servers && servers.length > 0) {
                    iceServers = servers as RTCIceServer[];
                }
            }
        } catch (e) {
            console.warn('[WebRTCBridge] Failed to fetch ICE servers:', e);
        }

        // Create peer connection
        this.peerConnection = new RTCPeerConnection({
            iceServers,
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceTransportPolicy: 'all',
        });

        // Add media tracks
        if (this.mediaStream) {
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            if (videoTrack) {
                if ('contentHint' in videoTrack) {
                    (videoTrack as any).contentHint = 'motion';
                }
                this.peerConnection.addTrack(videoTrack, this.mediaStream);
                console.log('[WebRTCBridge] Added video track to bridge connection');
            }

            const audioTrack = this.mediaStream.getAudioTracks()[0];
            if (audioTrack) {
                this.peerConnection.addTrack(audioTrack, this.mediaStream);
                console.log('[WebRTCBridge] Added audio track to bridge connection');
            }
        }

        // Create data channels for input and video
        this.inputChannel = this.peerConnection.createDataChannel('input', {
            ordered: false,
            maxRetransmits: 0,
            negotiated: true,
            id: 0,
            priority: 'high',
        } as RTCDataChannelInit);

        this.videoChannel = this.peerConnection.createDataChannel('video', {
            ordered: true,
            maxRetransmits: 0,
            negotiated: true,
            id: 1,
            priority: 'high',
        } as RTCDataChannelInit);

        this.inputChannel.binaryType = 'arraybuffer';
        this.videoChannel.binaryType = 'arraybuffer';

        // Handle input from client
        this.inputChannel.onmessage = (event) => {
            if (this.onInputReceived && event.data instanceof ArrayBuffer && event.data.byteLength === GAMEPAD_PACKET_SIZE) {
                try {
                    const input = decodeGamepadInput(event.data);
                    this.onInputReceived(input);
                } catch (e) {
                    // Silently drop malformed input
                }
            }
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({
                    from: this.hostId,
                    to: this.clientPeerId,
                    type: 'ice',
                    payload: event.candidate.toJSON(),
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log(`[WebRTCBridge] Connection state: ${state}`);
            if (state === 'connected') {
                console.log('[WebRTCBridge] ✓ WebRTC bridge established with client');
            } else if (state === 'failed' || state === 'closed') {
                console.log('[WebRTCBridge] Bridge connection lost');
            }
        };

        // Create offer and send to client
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            await this.sendSignalingMessage({
                from: this.hostId,
                to: this.clientPeerId,
                type: 'offer',
                payload: offer,
            });

            console.log('[WebRTCBridge] SDP offer sent to client');
        } catch (e) {
            console.error('[WebRTCBridge] Failed to create offer:', e);
            // Clean up to prevent media stream leaks
            this.destroy();
            return;
        }

        // Start polling for signaling messages from client
        this.startSignalPoll();
    }

    /**
     * Send a hardware-encoded frame over the bridge DataChannel
     */
    sendVideoFrame(frame: { frameNumber: number; timestampUs: bigint | number; isKeyframe: boolean; data: Uint8Array | Buffer }): void {
        if (!this.videoChannel || this.videoChannel.readyState !== 'open') return;

        // Protocol: [4b frameNum][8b timestampUs][1b isKeyframe][data...]
        const buffer = new ArrayBuffer(13 + frame.data.length);
        const view = new DataView(buffer);
        view.setUint32(0, frame.frameNumber);

        const ts = typeof frame.timestampUs === 'bigint' ? frame.timestampUs : BigInt(frame.timestampUs);
        view.setBigUint64(4, ts);
        view.setUint8(12, frame.isKeyframe ? 1 : 0);

        const dataArr = new Uint8Array(buffer);
        dataArr.set(new Uint8Array(frame.data), 13);

        try {
            this.videoChannel.send(buffer);
        } catch (e) {
            // Drop frame silently on send failure
        }
    }

    /**
     * Capture screen for WebRTC MediaStream
     */
    private async captureScreen(displayId: string): Promise<void> {
        let width = 1920;
        let height = 1080;

        switch (this.settings.resolution) {
            case 'detect': /* Native resolution */ break;
            case '720p': width = 1280; height = 720; break;
            case '1080p': width = 1920; height = 1080; break;
            case '1440p': width = 2560; height = 1440; break;
            case '4k': width = 3840; height = 2160; break;
        }

        const videoConstraints: any = {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: displayId,
                minFrameRate: 30,
                maxFrameRate: this.settings.fps || 60,
            },
        };

        if (this.settings.resolution !== 'detect') {
            videoConstraints.mandatory.minWidth = width;
            videoConstraints.mandatory.maxWidth = width;
            videoConstraints.mandatory.minHeight = height;
            videoConstraints.mandatory.maxHeight = height;
        }

        try {
            // Try combined audio + video first
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                    }
                } as any,
                video: videoConstraints as any,
            });
            console.log('[WebRTCBridge] Screen captured with audio');
        } catch (e) {
            // Fallback to video only
            try {
                this.mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: videoConstraints as any,
                });
                console.log('[WebRTCBridge] Screen captured (video only)');
            } catch (videoError) {
                console.error('[WebRTCBridge] Screen capture failed:', videoError);
            }
        }
    }

    /**
     * Listen for signaling messages from the client via WebSocket
     */
    private startSignalPoll(): void {
        this.wsClient = new WebSocketSignalingClient(SIGNALING_BASE);

        // Set peerId and sessionCode on the SignalingClient so HTTP fallback
        // and WS signal paths include correct `from`/`sessionCode` fields.
        (this.wsClient as any).peerId = this.hostId;
        (this.wsClient as any).sessionCode = this.sessionCode;

        this.wsClient.onopen = () => {
            const ws = (this.wsClient as any).ws;
            if (ws && ws.readyState === 1) { // OPEN
                ws.send(JSON.stringify({ action: 'register', sessionCode: this.sessionCode, peerId: this.hostId }));
            }
        };
        this.wsClient.onmessage = async (event: any) => {
            if (!this.isActive) return;
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'signal') {
                    await this.handleSignalingMessage(msg.data);
                }
            } catch (e) {
                // Ignore parsing errors
            }
        };
    }

    /**
     * Handle incoming signaling message from client
     */
    private async handleSignalingMessage(message: any): Promise<void> {
        if (!this.peerConnection) return;

        const payload = message.payload;
        if (!payload) return;

        try {
            if (payload.candidate !== undefined) {
                console.log('[WebRTCBridge] Adding ICE candidate from client');
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload));
            } else if (payload.type === 'answer' && payload.sdp) {
                console.log('[WebRTCBridge] Received answer from client');
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload)
                );
            } else if (payload.type === 'offer' && payload.sdp) {
                // Client re-offered (unusual but handle it)
                console.log('[WebRTCBridge] Received re-offer from client');
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload)
                );
                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                await this.sendSignalingMessage({
                    from: this.hostId,
                    to: this.clientPeerId,
                    type: 'answer',
                    payload: answer,
                });
            }
        } catch (e) {
            console.error('[WebRTCBridge] Error handling signaling message:', e);
        }
    }

    /**
     * Send signaling message to client via WebSocket
     */
    private async sendSignalingMessage(msg: any): Promise<void> {
        if (!this.isActive || !this.wsClient) return;
        try {
            this.wsClient.send(JSON.stringify({
                type: 'signal',
                sessionCode: this.sessionCode,
                to: msg.to,
                payload: { ...msg.payload, type: msg.type }
            }));
        } catch (e) {
            console.error('[WebRTCBridge] Failed to send signaling message:', e);
        }
    }

    /**
     * Stop the bridge
     */
    destroy(): void {
        this.isActive = false;

        if (this.wsClient) {
            this.wsClient.close();
            this.wsClient = null;
        }

        if (this.inputChannel) {
            this.inputChannel.close();
            this.inputChannel = null;
        }

        if (this.videoChannel) {
            this.videoChannel.close();
            this.videoChannel = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }

        console.log('[WebRTCBridge] Destroyed');
    }

    isConnected(): boolean {
        return this.peerConnection?.connectionState === 'connected';
    }
}
