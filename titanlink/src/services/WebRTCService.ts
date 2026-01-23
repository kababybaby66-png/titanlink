/**
 * WebRTC Service - Runs in Renderer Process
 * Handles all WebRTC operations for both host and client modes
 */

import { v4 as uuidv4 } from 'uuid';
import type {
    ConnectionState,
    PeerInfo,
    GamepadInputState,
    StreamSettings,
} from '../../shared/types/ipc';
import {
    GAMEPAD_PACKET_SIZE,
    encodeGamepadInput,
    decodeGamepadInput,
    DEFAULT_SETTINGS,
} from '../../shared/types/ipc';

interface OutgoingSignal {
    type: 'create-session' | 'join-session' | 'signal' | 'leave-session';
    sessionCode?: string;
    hostId?: string;
    clientId?: string;
    to?: string;
    from?: string;
    payload?: any;
}

interface IncomingSignal {
    type: 'session-created' | 'session-joined' | 'session-not-found' | 'error' | 'peer-joined' | 'peer-left' | 'host-left' | 'signal';
    data?: any;
}

// Signaling server configuration
// Supports both public server and direct IP connection modes
const PUBLIC_SIGNALING_SERVER = 'wss://titanlink-signaling.onrender.com';

// Connection mode types
export type SignalingMode = 'public' | 'direct';

// Store the current signaling URL (can be changed at runtime)
let currentSignalingUrl: string = PUBLIC_SIGNALING_SERVER;
let currentMode: SignalingMode = 'public';

// Set the signaling server URL (called when hosting with direct mode)
export const setSignalingUrl = (url: string, mode: SignalingMode = 'public') => {
    currentSignalingUrl = url;
    currentMode = mode;
};

// Get the current signaling mode
export const getSignalingMode = (): SignalingMode => currentMode;

// Get signaling server URL based on mode
const getSignalingServerUrl = async (): Promise<string> => {
    // If using embedded/direct mode, try to get URL from electron
    if (currentMode === 'direct' && window.electronAPI?.signaling?.getUrl) {
        const url = await window.electronAPI.signaling.getUrl();
        if (url) return url;
    }
    return currentSignalingUrl;
};

const ICE_SERVERS: RTCIceServer[] = [
    // STUN servers for discovering public IP
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },

    // Metered Free TURN servers (more reliable than OpenRelay)
    // These have higher availability and verified credentials
    {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'e8dd65c92eb8e6d8e6c66847',
        credential: 'uWdWNmkhvyqTW1QP',
    },
    {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: 'e8dd65c92eb8e6d8e6c66847',
        credential: 'uWdWNmkhvyqTW1QP',
    },
    {
        urls: 'turn:global.relay.metered.ca:443',
        username: 'e8dd65c92eb8e6d8e6c66847',
        credential: 'uWdWNmkhvyqTW1QP',
    },
    {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: 'e8dd65c92eb8e6d8e6c66847',
        credential: 'uWdWNmkhvyqTW1QP',
    },
];

export interface WebRTCServiceCallbacks {
    onStateChange: (state: ConnectionState) => void;
    onPeerConnected: (peer: PeerInfo) => void;
    onPeerDisconnected: () => void;
    onError: (error: string) => void;
    onLatencyUpdate?: (latencyMs: number) => void;
    onStreamReceived?: (stream: MediaStream) => void;
    onInputReceived?: (input: GamepadInputState) => void;
}

class WebRTCService {
    private ws: WebSocket | null = null;
    private peerConnection: RTCPeerConnection | null = null;
    private inputChannel: RTCDataChannel | null = null;
    private sessionCode: string = '';
    private peerId: string = '';
    private role: 'host' | 'client' | null = null;
    private callbacks: WebRTCServiceCallbacks | null = null;
    private mediaStream: MediaStream | null = null;
    private latencyInterval: ReturnType<typeof setInterval> | null = null;
    private pendingOffer: RTCSessionDescriptionInit | null = null;

    constructor() {
        this.peerId = uuidv4().substring(0, 8);
    }

    private sendSignal(message: OutgoingSignal): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    async startHosting(displayId: string, callbacks: WebRTCServiceCallbacks, useDirect: boolean = false): Promise<string> {
        this.callbacks = callbacks;
        this.role = 'host';
        this.sessionCode = this.generateSessionCode();

        try {
            callbacks.onStateChange('connecting');

            // If using direct mode, start the embedded signaling server
            if (useDirect && window.electronAPI?.signaling?.start) {
                const url = await window.electronAPI.signaling.start();
                setSignalingUrl(url, 'direct');
            } else {
                // Use the public signaling server
                setSignalingUrl(PUBLIC_SIGNALING_SERVER, 'public');
            }

            await this.startScreenCapture(displayId);
            await this.connectToSignalingServer();
            await this.createSession();
            this.initializePeerConnection();
            this.createInputChannel();

            callbacks.onStateChange('waiting-for-peer');
            return this.sessionCode;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start hosting';
            callbacks.onError(message);
            throw error;
        }
    }

    async connectToHost(sessionCode: string, callbacks: WebRTCServiceCallbacks): Promise<void> {
        this.callbacks = callbacks;
        this.role = 'client';
        this.sessionCode = sessionCode.toUpperCase();

        try {
            callbacks.onStateChange('connecting');

            await this.connectToSignalingServer();
            await this.joinSession();
            this.initializePeerConnection();
            this.createInputChannel();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to connect';
            callbacks.onError(message);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (this.latencyInterval) {
            clearInterval(this.latencyInterval);
            this.latencyInterval = null;
        }

        if (this.inputChannel) {
            this.inputChannel.close();
            this.inputChannel = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.ws) {
            this.sendSignal({ type: 'leave-session', sessionCode: this.sessionCode });
            this.ws.close();
            this.ws = null;
        }

        this.role = null;
        this.sessionCode = '';
        this.callbacks?.onStateChange('disconnected');
    }

    sendInput(input: GamepadInputState): void {
        if (this.role !== 'client' || !this.inputChannel || this.inputChannel.readyState !== 'open') {
            return;
        }

        try {
            const buffer = encodeGamepadInput(input);
            this.inputChannel.send(buffer);
        } catch {
            // Silently drop - UDP-like behavior
        }
    }

    private generateSessionCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    private settings: StreamSettings = DEFAULT_SETTINGS;

    updateSettings(settings: StreamSettings): void {
        this.settings = settings;
    }

    private async startScreenCapture(displayId: string): Promise<void> {
        let width = 1920;
        let height = 1080;

        switch (this.settings.resolution) {
            case '720p': width = 1280; height = 720; break;
            case '1080p': width = 1920; height = 1080; break;
            case '1440p': width = 2560; height = 1440; break;
            case '4k': width = 3840; height = 2160; break;
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: displayId,
                        minWidth: width,
                        maxWidth: width,
                        minHeight: height,
                        maxHeight: height,
                        minFrameRate: this.settings.fps,
                        maxFrameRate: this.settings.fps,
                    },
                } as MediaTrackConstraints,
            });
        } catch (error) {
            console.error('Screen capture error:', error);
            throw new Error('Failed to capture screen. Please check system permissions.');
        }
    }

    private async connectToSignalingServer(retryCount: number = 0): Promise<void> {
        const serverUrl = await getSignalingServerUrl();
        const maxRetries = 3;
        // Render.com free tier can take 30-90s to wake from sleep, use 60s timeout
        const connectionTimeout = 60000;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.ws) {
                    this.ws.close();
                }
                if (retryCount < maxRetries) {
                    console.log(`Connection attempt ${retryCount + 1} timed out, retrying...`);
                    this.connectToSignalingServer(retryCount + 1).then(resolve).catch(reject);
                } else {
                    reject(new Error('Connection timeout - signaling server may be unavailable. Please try again in a moment.'));
                }
            }, connectionTimeout);

            console.log(`Connecting to signaling server (attempt ${retryCount + 1}/${maxRetries + 1})...`);
            this.ws = new WebSocket(serverUrl);

            this.ws.onopen = () => {
                clearTimeout(timeout);
                console.log('Connected to signaling server');
                resolve();
            };

            this.ws.onerror = (error) => {
                clearTimeout(timeout);
                console.error('Signaling connection error:', error);
                if (retryCount < maxRetries) {
                    console.log(`Retrying connection (${retryCount + 2}/${maxRetries + 1})...`);
                    setTimeout(() => {
                        this.connectToSignalingServer(retryCount + 1).then(resolve).catch(reject);
                    }, 2000 * (retryCount + 1)); // Exponential backoff: 2s, 4s, 6s
                } else {
                    reject(new Error('Failed to connect to signaling server after multiple attempts'));
                }
            };

            this.ws.onmessage = async (event) => {
                console.log('[WebRTC] Raw message received:', event.data);
                try {
                    const message: IncomingSignal = JSON.parse(event.data);
                    console.log('[WebRTC] Message type:', message.type);

                    if (message.type === 'session-created') {
                        console.log('[WebRTC] session-created received in main handler');
                        clearTimeout(timeout);
                        console.log('Session created:', this.sessionCode);
                    } else if (message.type === 'session-joined') {
                        clearTimeout(timeout);
                        console.log('Joined session, host:', message.data?.hostId);
                        this.callbacks?.onPeerConnected({
                            peerId: message.data?.hostId,
                            username: 'Host',
                            connectedAt: Date.now(),
                        });
                        this.callbacks?.onStateChange('streaming');
                    } else if (message.type === 'session-not-found') {
                        clearTimeout(timeout);
                        reject(new Error('Session not found. Check the code and try again.'));
                    } else if (message.type === 'error') {
                        clearTimeout(timeout);
                        reject(new Error(message.data || 'Server error'));
                    } else if (message.type === 'peer-joined') {
                        if (this.role === 'host') {
                            await this.handlePeerJoined(message.data?.peerId);
                        }
                    } else if (message.type === 'host-left') {
                        console.log('Host disconnected');
                        this.callbacks?.onPeerDisconnected();
                        this.disconnect();
                    } else if (message.type === 'peer-left') {
                        console.log('Peer left - Closing session');
                        this.callbacks?.onPeerDisconnected();
                        this.disconnect();
                    } else if (message.type === 'signal' && message.data) {
                        await this.handleSignalMessage(message.data);
                    }
                } catch (e) {
                    console.error('Error parsing signal:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
            };
        });
    }

    private createSession(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error('[WebRTC] Session creation TIMEOUT after 10s');
                reject(new Error('Session creation timeout'));
            }, 10000);

            const checkCreated = (event: MessageEvent) => {
                console.log('[WebRTC] Received message:', event.data);
                try {
                    const message: IncomingSignal = JSON.parse(event.data);
                    console.log('[WebRTC] Parsed message type:', message.type);
                    if (message.type === 'session-created') {
                        console.log('[WebRTC] Session created confirmed!');
                        clearTimeout(timeout);
                        this.ws?.removeEventListener('message', checkCreated);
                        resolve();
                    } else if (message.type === 'error') {
                        console.error('[WebRTC] Server error:', message.data);
                        clearTimeout(timeout);
                        this.ws?.removeEventListener('message', checkCreated);
                        reject(new Error(message.data || 'Server error'));
                    }
                } catch (e) {
                    console.error('[WebRTC] Failed to parse message:', e);
                }
            };

            this.ws?.addEventListener('message', checkCreated);

            const msg: OutgoingSignal = {
                type: 'create-session',
                sessionCode: this.sessionCode,
                hostId: this.peerId,
            };
            console.log('[WebRTC] Sending create-session:', JSON.stringify(msg));
            this.sendSignal(msg);
        });
    }

    private joinSession(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Join timeout'));
            }, 10000);

            const checkJoined = (event: MessageEvent) => {
                try {
                    const message: IncomingSignal = JSON.parse(event.data);
                    if (message.type === 'session-joined') {
                        clearTimeout(timeout);
                        this.ws?.removeEventListener('message', checkJoined);
                        console.log('Joined session, host:', message.data?.hostId);
                        resolve();
                    } else if (message.type === 'session-not-found') {
                        clearTimeout(timeout);
                        this.ws?.removeEventListener('message', checkJoined);
                        reject(new Error('Session not found. Check the code and try again.'));
                    }
                } catch {
                    // Ignore parse errors
                }
            };

            this.ws?.addEventListener('message', checkJoined);

            this.sendSignal({
                type: 'join-session',
                sessionCode: this.sessionCode,
                clientId: this.peerId,
            });
        });
    }

    private initializePeerConnection(): void {
        console.log('[WebRTC] Initializing peer connection with ICE servers:', ICE_SERVERS.length);

        this.peerConnection = new RTCPeerConnection({
            iceServers: ICE_SERVERS,
            iceCandidatePoolSize: 10, // Pre-gather candidates for faster connection
        });

        // Log ICE gathering state changes
        this.peerConnection.onicegatheringstatechange = () => {
            console.log('[WebRTC] ICE gathering state:', this.peerConnection?.iceGatheringState);
        };

        // Log ICE connection state changes  
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE connection state:', this.peerConnection?.iceConnectionState);
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // Log candidate type for debugging (host, srflx, relay)
                const candidateStr = event.candidate.candidate;
                const typeMatch = candidateStr.match(/typ (\w+)/);
                const candidateType = typeMatch ? typeMatch[1] : 'unknown';
                console.log(`[WebRTC] ICE candidate: ${candidateType} - ${event.candidate.address || 'no-address'}`);

                this.sendSignal({
                    type: 'signal',
                    sessionCode: this.sessionCode,
                    from: this.peerId,
                    payload: event.candidate.toJSON(),
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log('Connection state:', state);

            if (state === 'connected') {
                this.callbacks?.onStateChange('streaming');
                this.startLatencyMeasurement();
            } else if (state === 'disconnected' || state === 'failed') {
                this.callbacks?.onPeerDisconnected();
                if (this.role === 'host') {
                    this.callbacks?.onStateChange('waiting-for-peer');
                } else {
                    this.disconnect();
                }
            }
        };

        this.peerConnection.ontrack = (event) => {
            console.log('Received track:', event.track.kind);
            if (event.streams[0]) {
                this.callbacks?.onStreamReceived?.(event.streams[0]);
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            if (event.channel.label === 'input') {
                this.setupInputChannel(event.channel);
            }
        };

        if (this.role === 'host' && this.mediaStream) {
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            if (videoTrack) {
                this.peerConnection.addTrack(videoTrack, this.mediaStream);
            }
        }
    }

    private createInputChannel(): void {
        if (!this.peerConnection) return;

        console.log('[WebRTC] Creating negotiated input channel (id: 0)');
        this.inputChannel = this.peerConnection.createDataChannel('input', {
            ordered: false,
            maxRetransmits: 0,
            negotiated: true,
            id: 0,
        });

        this.setupInputChannel(this.inputChannel);
    }

    private setupInputChannel(channel: RTCDataChannel): void {
        console.log('[WebRTC] Setting up input channel (Host side)');
        this.inputChannel = channel;
        channel.binaryType = 'arraybuffer';

        channel.onmessage = (event) => {
            // console.log('[WebRTC] Data channel msg:', event.data.byteLength);
            if (event.data instanceof ArrayBuffer && event.data.byteLength === GAMEPAD_PACKET_SIZE) {
                const input = decodeGamepadInput(event.data);
                // console.log('[WebRTC] Input decoded:', input.buttons);
                this.callbacks?.onInputReceived?.(input);
                window.electronAPI?.controller.sendInput(input);
            } else {
                console.warn('[WebRTC] Invalid input packet size:', event.data.byteLength, 'Expected:', GAMEPAD_PACKET_SIZE);
            }
        };

        channel.onopen = () => {
            console.log('Input channel opened (host)');
        };
    }

    private async handlePeerJoined(peerId: string): Promise<void> {
        if (!this.peerConnection) return;

        const peer: PeerInfo = {
            peerId,
            username: 'Player 2',
            connectedAt: Date.now(),
        };

        try {
            const offer = await this.peerConnection.createOffer();

            if (offer.sdp && this.settings.bitrate) {
                offer.sdp = this.setBandwidth(offer.sdp, this.settings.bitrate);
            }

            await this.peerConnection.setLocalDescription(offer);

            this.sendSignal({
                type: 'signal',
                sessionCode: this.sessionCode,
                from: this.peerId,
                to: peerId,
                payload: offer,
            });

            this.callbacks?.onPeerConnected(peer);
        } catch (error) {
            console.error('Error creating offer:', error);
            this.callbacks?.onError('Failed to create connection');
        }
    }

    private async handleSignalMessage(message: any): Promise<void> {
        if (!this.peerConnection) return;

        const payload = message.payload;
        if (!payload) {
            console.warn('Received signal message without payload:', message);
            return;
        }

        console.log('[WebRTC] handleSignalMessage - payload type:', payload.type, 'has candidate:', !!payload.candidate);

        try {
            // Check if this is an ICE candidate (has 'candidate' property)
            if (payload.candidate !== undefined) {
                console.log('[WebRTC] Adding ICE candidate');
                await this.peerConnection.addIceCandidate(
                    new RTCIceCandidate(payload)
                );
            }
            // Check if this is an offer (SDP with type 'offer')
            else if (payload.type === 'offer' && payload.sdp) {
                console.log('[WebRTC] Received offer, creating answer');
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload)
                );

                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);

                this.sendSignal({
                    type: 'signal',
                    sessionCode: this.sessionCode,
                    from: this.peerId,
                    to: message.from,
                    payload: answer,
                });

                if (this.role === 'client') {
                    this.callbacks?.onPeerConnected({
                        peerId: message.from,
                        username: 'Host',
                        connectedAt: Date.now(),
                    });
                }
            }
            // Check if this is an answer (SDP with type 'answer')  
            else if (payload.type === 'answer' && payload.sdp) {
                console.log('[WebRTC] Received answer, setting remote description');
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload)
                );
            }
            else {
                console.warn('[WebRTC] Unknown signal payload:', payload);
            }
        } catch (error) {
            console.error('Error handling signal:', error);
        }
    }

    private startLatencyMeasurement(): void {
        this.latencyInterval = setInterval(async () => {
            if (!this.peerConnection) return;

            try {
                const stats = await this.peerConnection.getStats();

                stats.forEach((report) => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        const rtt = report.currentRoundTripTime;
                        if (rtt !== undefined) {
                            const latencyMs = Math.round((rtt * 1000) / 2);
                            this.callbacks?.onLatencyUpdate?.(latencyMs);
                        }
                    }
                });
            } catch (error) {
                console.error('Error getting RTT:', error);
            }
        }, 1000);
    }

    private setBandwidth(sdp: string, bitrateMbps: number): string {
        const bitrateKbps = bitrateMbps * 1000;
        const modifier = 'b=AS:' + bitrateKbps;

        const lines = sdp.split('\n');
        const newLines = lines.map(line => line.trim());

        for (let i = 0; i < newLines.length; i++) {
            if (newLines[i].startsWith('m=video')) {
                i++;
                while (i < newLines.length && newLines[i] && (newLines[i].startsWith('i=') || newLines[i].startsWith('c=') || newLines[i].startsWith('b=') || newLines[i].startsWith('a='))) {
                    if (newLines[i].startsWith('b=AS:')) {
                        newLines.splice(i, 1);
                        i--;
                    }
                    i++;
                }
                newLines.splice(i, 0, modifier);
            }
        }

        return newLines.join('\r\n');
    }

    getSessionCode(): string {
        return this.sessionCode;
    }

    getRole(): 'host' | 'client' | null {
        return this.role;
    }

    isConnected(): boolean {
        return this.peerConnection?.connectionState === 'connected';
    }
}

export const webrtcService = new WebRTCService();
