/**
 * WebRTC Service - Runs in Renderer Process
 * Handles all WebRTC operations for both host and client modes
 */

import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import type {
    ConnectionState,
    PeerInfo,
    GamepadInputState,
    SignalMessage,
    StreamSettings,
} from '../../shared/types/ipc';
import {
    GAMEPAD_PACKET_SIZE,
    encodeGamepadInput,
    decodeGamepadInput,
    DEFAULT_SETTINGS,
} from '../../shared/types/ipc';

// Signaling server URL - use localhost for development
const SIGNALING_SERVER = import.meta.env.VITE_SIGNALING_SERVER || 'http://localhost:3001';

// ICE servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
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
    private socket: Socket | null = null;
    private peerConnection: RTCPeerConnection | null = null;
    private inputChannel: RTCDataChannel | null = null;
    private sessionCode: string = '';
    private peerId: string = '';
    private role: 'host' | 'client' | null = null;
    private callbacks: WebRTCServiceCallbacks | null = null;
    private mediaStream: MediaStream | null = null;
    private latencyInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.peerId = uuidv4().substring(0, 8);
    }

    /**
     * Start hosting a session
     */
    async startHosting(displayId: string, callbacks: WebRTCServiceCallbacks): Promise<string> {
        this.callbacks = callbacks;
        this.role = 'host';
        this.sessionCode = this.generateSessionCode();

        try {
            callbacks.onStateChange('connecting');

            // Start screen capture first
            await this.startScreenCapture(displayId);

            // Connect to signaling server
            await this.connectToSignalingServer();

            // Create session on server
            await this.createSession();

            // Initialize peer connection
            this.initializePeerConnection();

            callbacks.onStateChange('waiting-for-peer');
            return this.sessionCode;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start hosting';
            callbacks.onError(message);
            throw error;
        }
    }

    /**
     * Connect to a host's session
     */
    async connectToHost(sessionCode: string, callbacks: WebRTCServiceCallbacks): Promise<void> {
        this.callbacks = callbacks;
        this.role = 'client';
        this.sessionCode = sessionCode.toUpperCase();

        try {
            callbacks.onStateChange('connecting');

            // Connect to signaling server
            await this.connectToSignalingServer();

            // Join existing session
            await this.joinSession();

            // Initialize peer connection
            this.initializePeerConnection();

            // Create data channel for input
            this.createInputChannel();

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to connect';
            callbacks.onError(message);
            throw error;
        }
    }

    /**
     * Disconnect and cleanup
     */
    async disconnect(): Promise<void> {
        // Stop latency measurement
        if (this.latencyInterval) {
            clearInterval(this.latencyInterval);
            this.latencyInterval = null;
        }

        // Close data channel
        if (this.inputChannel) {
            this.inputChannel.close();
            this.inputChannel = null;
        }

        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Stop media stream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Leave session and disconnect socket
        if (this.socket) {
            this.socket.emit('leave-session', { sessionCode: this.sessionCode });
            this.socket.disconnect();
            this.socket = null;
        }

        this.role = null;
        this.sessionCode = '';
        this.callbacks?.onStateChange('disconnected');
    }

    /**
     * Send controller input (client only)
     */
    sendInput(input: GamepadInputState): void {
        if (this.role !== 'client' || !this.inputChannel || this.inputChannel.readyState !== 'open') {
            return;
        }

        try {
            const buffer = encodeGamepadInput(input);
            this.inputChannel.send(buffer);
        } catch (error) {
            // Silently drop - UDP-like behavior
        }
    }

    /**
     * Generate a 6-character session code
     */
    private generateSessionCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    private settings: StreamSettings = DEFAULT_SETTINGS;

    /**
     * Update stream settings
     */
    updateSettings(settings: StreamSettings): void {
        this.settings = settings;
    }

    // ... (existing methods)

    /**
     * Start screen capture (host only)
     */
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
            // Use getUserMedia (instead of getDisplayMedia) to capture a specific source ID without a picker
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    // Electron-specific constraint to use specific source
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

    /**
     * Connect to signaling server
     */
    private connectToSignalingServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 15000);

            this.socket = io(SIGNALING_SERVER, {
                transports: ['websocket', 'polling'],
                timeout: 10000,
            });

            this.socket.on('connect', () => {
                clearTimeout(timeout);
                console.log('Connected to signaling server');
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to connect: ${error.message}`));
            });

            // Setup signal handler
            this.socket.on('signal', async (message: SignalMessage) => {
                await this.handleSignalMessage(message);
            });

            // Host: peer joined
            this.socket.on('peer-joined', async (data: { peerId: string }) => {
                console.log('Peer joined:', data.peerId);
                if (this.role === 'host') {
                    await this.handlePeerJoined(data.peerId);
                }
            });

            // Client: host left
            this.socket.on('host-left', () => {
                console.log('Host disconnected');
                this.callbacks?.onPeerDisconnected();
                this.disconnect();
            });

            // Host: peer left
            this.socket.on('peer-left', () => {
                console.log('Peer left');
                this.callbacks?.onPeerDisconnected();
                this.callbacks?.onStateChange('waiting-for-peer');
            });

            this.socket.on('error', (error: string) => {
                console.error('Signaling error:', error);
                this.callbacks?.onError(error);
            });
        });
    }

    /**
     * Create session (host)
     */
    private createSession(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('Not connected'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Session creation timeout'));
            }, 10000);

            this.socket.once('session-created', () => {
                clearTimeout(timeout);
                console.log('Session created:', this.sessionCode);
                resolve();
            });

            this.socket.once('error', (error: string) => {
                clearTimeout(timeout);
                reject(new Error(error));
            });

            this.socket.emit('create-session', {
                sessionCode: this.sessionCode,
                hostId: this.peerId,
            });
        });
    }

    /**
     * Join existing session (client)
     */
    private joinSession(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('Not connected'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Join timeout'));
            }, 10000);

            this.socket.once('session-joined', (data: { hostId: string }) => {
                clearTimeout(timeout);
                console.log('Joined session, host:', data.hostId);
                resolve();
            });

            this.socket.once('session-not-found', () => {
                clearTimeout(timeout);
                reject(new Error('Session not found. Check the code and try again.'));
            });

            this.socket.emit('join-session', {
                sessionCode: this.sessionCode,
                clientId: this.peerId,
            });
        });
    }

    /**
     * Initialize WebRTC peer connection
     */
    private initializePeerConnection(): void {
        this.peerConnection = new RTCPeerConnection({
            iceServers: ICE_SERVERS,
        });

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket?.emit('signal', {
                    type: 'ice-candidate',
                    sessionCode: this.sessionCode,
                    from: this.peerId,
                    payload: event.candidate.toJSON(),
                } as SignalMessage);
            }
        };

        // Handle connection state
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

        // Handle incoming tracks (client receives video)
        this.peerConnection.ontrack = (event) => {
            console.log('Received track:', event.track.kind);
            if (event.streams[0]) {
                this.callbacks?.onStreamReceived?.(event.streams[0]);
            }
        };

        // Handle incoming data channel (host receives input)
        this.peerConnection.ondatachannel = (event) => {
            if (event.channel.label === 'input') {
                this.setupInputChannel(event.channel);
            }
        };

        // Add video track if hosting
        if (this.role === 'host' && this.mediaStream) {
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            if (videoTrack) {
                this.peerConnection.addTrack(videoTrack, this.mediaStream);
            }
        }
    }

    /**
     * Create input data channel (client only)
     */
    private createInputChannel(): void {
        if (!this.peerConnection) return;

        // CRITICAL: Unreliable, unordered channel for UDP-like behavior
        this.inputChannel = this.peerConnection.createDataChannel('input', {
            ordered: false,
            maxRetransmits: 0,
        });

        this.inputChannel.binaryType = 'arraybuffer';

        this.inputChannel.onopen = () => {
            console.log('Input channel opened');
        };

        this.inputChannel.onclose = () => {
            console.log('Input channel closed');
        };
    }

    /**
     * Setup received input channel (host only)
     */
    private setupInputChannel(channel: RTCDataChannel): void {
        this.inputChannel = channel;
        channel.binaryType = 'arraybuffer';

        channel.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer && event.data.byteLength === GAMEPAD_PACKET_SIZE) {
                const input = decodeGamepadInput(event.data);
                this.callbacks?.onInputReceived?.(input);

                // Forward to main process for virtual controller
                window.electronAPI?.controller.sendInput(input);
            }
        };

        channel.onopen = () => {
            console.log('Input channel opened (host)');
        };
    }

    /**
     * Handle peer joined (host creates offer)
     */
    private async handlePeerJoined(peerId: string): Promise<void> {
        if (!this.peerConnection) return;

        const peer: PeerInfo = {
            peerId,
            username: 'Player 2',
            connectedAt: Date.now(),
        };

        try {
            const offer = await this.peerConnection.createOffer();

            // Apply bandwidth limit to SDP
            if (offer.sdp && this.settings.bitrate) {
                offer.sdp = this.setBandwidth(offer.sdp, this.settings.bitrate);
            }

            await this.peerConnection.setLocalDescription(offer);

            this.socket?.emit('signal', {
                type: 'offer',
                sessionCode: this.sessionCode,
                from: this.peerId,
                to: peerId,
                payload: offer,
            } as SignalMessage);

            this.callbacks?.onPeerConnected(peer);
        } catch (error) {
            console.error('Error creating offer:', error);
            this.callbacks?.onError('Failed to create connection');
        }
    }

    /**
     * Handle signaling messages
     */
    private async handleSignalMessage(message: SignalMessage): Promise<void> {
        if (!this.peerConnection) return;

        try {
            if (message.type === 'offer' && message.payload) {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
                );

                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);

                this.socket?.emit('signal', {
                    type: 'answer',
                    sessionCode: this.sessionCode,
                    from: this.peerId,
                    to: message.from,
                    payload: answer,
                } as SignalMessage);

                // Client received offer = host is connected
                if (this.role === 'client') {
                    this.callbacks?.onPeerConnected({
                        peerId: message.from,
                        username: 'Host',
                        connectedAt: Date.now(),
                    });
                }
            } else if (message.type === 'answer' && message.payload) {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
                );
            } else if (message.type === 'ice-candidate' && message.payload) {
                await this.peerConnection.addIceCandidate(
                    new RTCIceCandidate(message.payload as RTCIceCandidateInit)
                );
            }
        } catch (error) {
            console.error('Error handling signal:', error);
        }
    }

    /**
     * Start latency measurement
     */
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

    /**
     * Set SDP bandwidth limit
     */
    private setBandwidth(sdp: string, bitrateMbps: number): string {
        const bitrateKbps = bitrateMbps * 1000;
        const modifier = 'b=AS:' + bitrateKbps;

        // Split SDP into lines
        const lines = sdp.split('\n');
        const newLines = lines.map(line => line.trim());

        // Iterate and replace/add bandwidth line
        for (let i = 0; i < newLines.length; i++) {
            if (newLines[i].startsWith('m=video')) {
                // Remove existing b=AS lines if any
                i++;
                while (i < newLines.length && newLines[i] && (newLines[i].startsWith('i=') || newLines[i].startsWith('c=') || newLines[i].startsWith('b=') || newLines[i].startsWith('a='))) {
                    if (newLines[i].startsWith('b=AS:')) {
                        newLines.splice(i, 1);
                        i--;
                    }
                    i++;
                }
                // Insert new bandwidth line after the block
                newLines.splice(i, 0, modifier);
            }
        }

        return newLines.join('\r\n');
    }

    // Getters
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

// Export singleton
export const webrtcService = new WebRTCService();
