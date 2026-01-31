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
import { CONFIG } from '../config';

// Supports both public server and direct IP connection modes
const PUBLIC_SIGNALING_SERVER = CONFIG.SIGNALING.URL;

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

// ICE servers configuration - expanded pool with TURN fallback
const ICE_SERVERS: RTCIceServer[] = [
    // Google STUN servers (high availability)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Mozilla STUN (backup)
    { urls: 'stun:stun.services.mozilla.com:3478' },
    // Twilio STUN (backup)
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Free public TURN servers (emergency fallback for NAT traversal)
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Network quality levels for adaptive bitrate
export type NetworkQualityLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

// Adaptive bitrate configuration
const ADAPTIVE_BITRATE_CONFIG = {
    // Thresholds for quality degradation
    thresholds: {
        latencyMs: { good: 50, fair: 100, poor: 200 },
        packetLoss: { good: 1, fair: 3, poor: 5 },
        jitter: { good: 20, fair: 40, poor: 80 },
    },
    // Bitrate multipliers based on quality level
    bitrateMultipliers: {
        excellent: 1.0,
        good: 0.85,
        fair: 0.65,
        poor: 0.45,
        critical: 0.25,
    },
    // Minimum time between bitrate adjustments (ms)
    adjustmentCooldownMs: 3000,
    // Number of samples to average for stability
    sampleWindow: 5,
};

export interface WebRTCServiceCallbacks {
    onStateChange: (state: ConnectionState) => void;
    onPeerConnected: (peer: PeerInfo) => void;
    onPeerDisconnected: () => void;
    onError: (error: string) => void;
    onLatencyUpdate?: (latencyMs: number) => void;
    onStreamReceived?: (stream: MediaStream) => void;
    onInputReceived?: (input: GamepadInputState) => void;
}

export interface ConnectionQuality {
    latency: number;
    packetLoss: number;
    jitter: number;
    hasAudio: boolean;
    networkQuality: NetworkQualityLevel;
    currentBitrate: number; // Current adjusted bitrate in Mbps
    targetBitrate: number;  // Original target bitrate in Mbps
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
    private dynamicIceServers: RTCIceServer[] | null = null;
    private hasLoggedConnectionStats = false;
    private hasAudioTrack = false;
    private previousPacketsLost = 0;
    private previousPacketsReceived = 0;
    private connectionQuality: ConnectionQuality = {
        latency: 0,
        packetLoss: 0,
        jitter: 0,
        hasAudio: false,
        networkQuality: 'excellent',
        currentBitrate: 10,
        targetBitrate: 10,
    };

    // Adaptive bitrate state
    private adaptiveBitrateEnabled: boolean = true;
    private lastBitrateAdjustment: number = 0;
    private latencySamples: number[] = [];
    private packetLossSamples: number[] = [];
    private jitterSamples: number[] = [];
    private videoSender: RTCRtpSender | null = null;
    private audioSender: RTCRtpSender | null = null;

    // FPS monitoring for stats overlay
    private actualFps: number = 0;
    private frameCount: number = 0;
    private lastFpsUpdate: number = 0;

    constructor() {
        this.peerId = uuidv4().substring(0, 8);
    }

    /**
     * Fetch ICE servers from Electron main process
     */
    private async fetchIceServers(): Promise<RTCIceServer[]> {
        // Try to get dynamic ICE servers (e.g., self-hosted TURN)
        if (window.electronAPI?.turn?.getIceServers) {
            try {
                const servers = await window.electronAPI.turn.getIceServers();
                if (servers && servers.length > 0) {
                    console.log(`[WebRTC] Got ${servers.length} ICE servers from Main process`);
                    return servers as RTCIceServer[];
                }
            } catch (error) {
                console.error('[WebRTC] Failed to fetch ICE servers:', error);
            }
        }

        console.log('[WebRTC] Using fallback ICE servers');
        return ICE_SERVERS;
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

            // Fetch ICE servers
            this.dynamicIceServers = await this.fetchIceServers();

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

            // Fetch ICE servers
            this.dynamicIceServers = await this.fetchIceServers();

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
        this.hasLoggedConnectionStats = false;

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
        const length = 6;
        let code = '';

        // Use crypto for secure random generation
        const randomValues = new Uint32Array(length);
        window.crypto.getRandomValues(randomValues);

        for (let i = 0; i < length; i++) {
            code += chars.charAt(randomValues[i] % chars.length);
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

        const videoConstraints = {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: displayId,
                minWidth: width,
                maxWidth: width,
                minHeight: height,
                maxHeight: height,
                minFrameRate: 30,
                maxFrameRate: this.settings.fps,
            },
        };

        // Check available audio devices for debugging
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            console.log('[WebRTC] Available audio inputs:', audioInputs.map(d => `${d.label} (${d.deviceId})`));
        } catch (e) {
            console.warn('[WebRTC] Failed to enumerate devices:', e);
        }

        // First, try to capture video with audio in a single call
        try {
            console.log('[WebRTC] Attempting screen capture with audio...');

            // Try with standard constraints first
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        // On some Windows systems, specifying the ID for audio causes failure
                        // Try matching it, but we might remove it in a fallback
                        chromeMediaSourceId: displayId,
                    }
                } as any,
                video: videoConstraints as any,
            });

            const audioTracks = this.mediaStream.getAudioTracks();
            const videoTracks = this.mediaStream.getVideoTracks();
            console.log('[WebRTC] Capture result:', {
                video: videoTracks.length,
                audio: audioTracks.length
            });

            if (audioTracks.length > 0) {
                console.log('[WebRTC] ✓ Audio capture successful!');
                return;
            }
        } catch (error) {
            console.warn('[WebRTC] Primary audio+video capture failed:', (error as Error).message);

            // Secondary attempt: Try without specifying audio source ID
            try {
                console.log('[WebRTC] Retrying with generic system audio reference...');
                this.mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                        }
                    } as any,
                    video: videoConstraints as any,
                });
                console.log('[WebRTC] ✓ Retry successful!');
                return;
            } catch (retryError) {
                console.warn('[WebRTC] Retry with "desktop" failed:', (retryError as Error).message);

                // Tertiary attempt: Try 'system' source (modern Electron)
                try {
                    console.log('[WebRTC] Attempting fallback to "system" audio source...');
                    this.mediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            mandatory: {
                                chromeMediaSource: 'system',
                            }
                        } as any,
                        video: videoConstraints as any,
                    });
                    console.log('[WebRTC] ✓ "System" audio fallback successful!');
                    return;
                } catch (systemError) {
                    console.error('[WebRTC] All audio capture attempts failed:', (systemError as Error).message);
                }
            }
        }

        // Fallback: Try video only
        try {
            console.log('[WebRTC] Falling back to video-only capture...');
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: videoConstraints as any,
            });
            console.log('[WebRTC] ✓ Video capture successful (no audio)');
            console.warn('[WebRTC] 💡 Tip: To enable audio, enable "Stereo Mix" in Windows Sound Settings > Recording');
        } catch (videoError) {
            console.error('[WebRTC] Screen capture failed:', videoError);
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
        const iceServers = this.dynamicIceServers || ICE_SERVERS;
        console.log('[WebRTC] Initializing peer connection with ICE servers:', iceServers.length);
        iceServers.forEach((s, i) => {
            const urls = Array.isArray(s.urls) ? s.urls.join(', ') : s.urls;
            console.log(`[WebRTC] Server [${i}]: ${urls} | Auth: ${s.username ? 'YES' : 'NO'}`);
        });

        // Optimized RTCPeerConnection configuration for better NAT traversal
        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceCandidatePoolSize: 10, // Pre-gather candidates for faster connection
            bundlePolicy: 'max-bundle', // Multiplex all media over single transport (reduces ports needed)
            rtcpMuxPolicy: 'require',   // Require RTCP multiplexing (simplifies NAT traversal)
            // Use all ICE candidate types (host, srflx, relay)
            iceTransportPolicy: 'all',
        });

        // Initialize adaptive bitrate tracking
        this.connectionQuality.targetBitrate = this.settings.bitrate;
        this.connectionQuality.currentBitrate = this.settings.bitrate;

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
                console.log(`[WebRTC] ICE candidate gathered: ${candidateType} - ${event.candidate.address || 'no-address'} (${event.candidate.protocol})`);

                this.sendSignal({
                    type: 'signal',
                    sessionCode: this.sessionCode,
                    from: this.peerId,
                    payload: event.candidate.toJSON(),
                });
            } else {
                console.log('[WebRTC] ICE candidate gathering finished (null candidate)');
            }
        };

        // Listen for ICE gathering errors (critical for debugging TURN)
        // @ts-ignore - event type might be missing in some TS definitions
        this.peerConnection.onicecandidateerror = (event: any) => {
            console.error(`[WebRTC] ICE Error ${event.errorCode}: ${event.errorText} at ${event.url || 'unknown URL'}`);
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log('[WebRTC] Connection state:', state);

            if (state === 'connected') {
                this.callbacks?.onStateChange('streaming');
                this.startLatencyMeasurement();
            } else if (state === 'disconnected') {
                // Connection temporarily lost - attempt ICE restart to recover
                console.log('[WebRTC] Connection disconnected - attempting recovery...');
                if (this.role === 'host' && this.settings.iceRestart) {
                    // Give it a moment before restarting ICE
                    setTimeout(() => {
                        if (this.peerConnection?.connectionState === 'disconnected') {
                            console.log('[WebRTC] Initiating ICE restart for recovery...');
                            this.attemptIceRestart().catch(e => {
                                console.error('[WebRTC] ICE restart failed during recovery:', e);
                            });
                        }
                    }, 2000);
                }
            } else if (state === 'failed') {
                console.error('[WebRTC] Connection failed - cannot recover');
                this.callbacks?.onPeerDisconnected();
                if (this.role === 'host') {
                    this.callbacks?.onStateChange('waiting-for-peer');
                } else {
                    this.disconnect();
                }
            }
        };

        this.peerConnection.ontrack = (event) => {
            console.log('[WebRTC] Received track:', event.track.kind, 'id:', event.track.id);
            if (event.track.kind === 'audio') {
                console.log('[WebRTC] Audio track received! Audio streaming is now available.');
            }
            if (event.streams[0]) {
                this.callbacks?.onStreamReceived?.(event.streams[0]);
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            if (event.channel.label === 'input') {
                this.setupInputChannel(event.channel);
            }
        };

        // Add media tracks when hosting
        if (this.role === 'host' && this.mediaStream) {
            // Add video track with sender reference for adaptive bitrate
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            if (videoTrack) {
                console.log('[WebRTC] Adding video track to peer connection');

                // LOW LATENCY: Set content hint to 'motion' for fast motion optimization
                if ('contentHint' in videoTrack) {
                    (videoTrack as any).contentHint = 'motion';
                    console.log('[WebRTC] Video track contentHint set to "motion" for low latency');
                }

                this.videoSender = this.peerConnection.addTrack(videoTrack, this.mediaStream);

                // Set codec preferences for optimal quality (prioritize H.264 hardware encoding)
                this.setCodecPreferences();

                // Apply low-latency encoder parameters
                this.applyLowLatencyEncoderSettings();
            }

            // Add audio track (critical for system audio streaming!)
            const audioTrack = this.mediaStream.getAudioTracks()[0];
            if (audioTrack) {
                console.log('[WebRTC] Adding audio track to peer connection - system audio will be streamed');
                this.audioSender = this.peerConnection.addTrack(audioTrack, this.mediaStream);
                this.hasAudioTrack = true;
                this.connectionQuality.hasAudio = true;

                // Apply audio bitrate settings
                this.applyAudioSettings();
            } else {
                console.warn('[WebRTC] No audio track available - system audio capture may have failed');
                this.hasAudioTrack = false;
                this.connectionQuality.hasAudio = false;
            }
        }
    }

    private createInputChannel(): void {
        if (!this.peerConnection) return;

        console.log('[WebRTC] Creating HIGH PRIORITY negotiated input channel (id: 0)');
        this.inputChannel = this.peerConnection.createDataChannel('input', {
            ordered: false,
            maxRetransmits: 0,
            negotiated: true,
            id: 0,
            // LOW LATENCY: Maximum priority for controller input
            priority: 'high',
        } as RTCDataChannelInit);

        // Set buffered amount low threshold to 0 for immediate sending
        this.inputChannel.bufferedAmountLowThreshold = 0;

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
        // LOW LATENCY: Poll every 500ms instead of 1000ms for faster adaptive response
        this.latencyInterval = setInterval(async () => {
            if (!this.peerConnection) return;

            try {
                const stats = await this.peerConnection.getStats();

                stats.forEach((report) => {
                    // Track connection quality from candidate-pair
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        // Log connection details once
                        if (!this.hasLoggedConnectionStats) {
                            this.hasLoggedConnectionStats = true;
                            const localCandidate = stats.get(report.localCandidateId);
                            const remoteCandidate = stats.get(report.remoteCandidateId);

                            console.log('--- Connection Details ---');
                            console.log(`[WebRTC] Connected via: ${localCandidate?.candidateType} <-> ${remoteCandidate?.candidateType}`);
                            console.log(`[WebRTC] Local: ${localCandidate?.ip}:${localCandidate?.port} (${localCandidate?.protocol})`);
                            console.log(`[WebRTC] Remote: ${remoteCandidate?.ip}:${remoteCandidate?.port} (${remoteCandidate?.protocol})`);
                            console.log('--------------------------');
                        }

                        const rtt = report.currentRoundTripTime;
                        if (rtt !== undefined) {
                            const latencyMs = Math.round((rtt * 1000) / 2);
                            this.connectionQuality.latency = latencyMs;
                            this.callbacks?.onLatencyUpdate?.(latencyMs);
                        }
                    }

                    // Track packet loss, jitter, and FPS from inbound-rtp
                    if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
                        const packetsLost = report.packetsLost || 0;
                        const packetsReceived = report.packetsReceived || 0;
                        const jitter = report.jitter || 0;

                        // Calculate packet loss percentage
                        const deltaLost = packetsLost - this.previousPacketsLost;
                        const deltaReceived = packetsReceived - this.previousPacketsReceived;
                        const totalDelta = deltaLost + deltaReceived;

                        if (totalDelta > 0) {
                            const lossPercent = (deltaLost / totalDelta) * 100;
                            this.connectionQuality.packetLoss = Math.round(lossPercent * 10) / 10;
                        }

                        this.connectionQuality.jitter = Math.round(jitter * 1000 * 10) / 10; // Convert to ms

                        this.previousPacketsLost = packetsLost;
                        this.previousPacketsReceived = packetsReceived;

                        // Track actual FPS from framesDecoded or framesPerSecond
                        const framesDecoded = report.framesDecoded || 0;
                        const now = Date.now();
                        const timeDelta = now - this.lastFpsUpdate;

                        if (timeDelta >= 1000 && this.lastFpsUpdate > 0) {
                            const framesDelta = framesDecoded - this.frameCount;
                            this.actualFps = Math.round((framesDelta / timeDelta) * 1000);
                            this.frameCount = framesDecoded;
                            this.lastFpsUpdate = now;
                        } else if (this.lastFpsUpdate === 0) {
                            this.frameCount = framesDecoded;
                            this.lastFpsUpdate = now;
                        }
                    }
                });

                // Run adaptive bitrate adjustment
                this.adjustBitrateIfNeeded();
            } catch (error) {
                console.error('Error getting RTT:', error);
            }
        }, 500); // LOW LATENCY: 500ms polling vs 1000ms
    }

    /**
     * Calculate network quality level based on current metrics
     */
    private calculateNetworkQuality(): NetworkQualityLevel {
        const { latency, packetLoss, jitter } = this.connectionQuality;
        const thresholds = ADAPTIVE_BITRATE_CONFIG.thresholds;

        // Score each metric (0 = excellent, 1 = good, 2 = fair, 3 = poor)
        let score = 0;

        if (latency >= thresholds.latencyMs.poor) score += 3;
        else if (latency >= thresholds.latencyMs.fair) score += 2;
        else if (latency >= thresholds.latencyMs.good) score += 1;

        if (packetLoss >= thresholds.packetLoss.poor) score += 3;
        else if (packetLoss >= thresholds.packetLoss.fair) score += 2;
        else if (packetLoss >= thresholds.packetLoss.good) score += 1;

        if (jitter >= thresholds.jitter.poor) score += 3;
        else if (jitter >= thresholds.jitter.fair) score += 2;
        else if (jitter >= thresholds.jitter.good) score += 1;

        // Map total score to quality level
        if (score <= 1) return 'excellent';
        if (score <= 3) return 'good';
        if (score <= 5) return 'fair';
        if (score <= 7) return 'poor';
        return 'critical';
    }

    /**
     * Adjust video bitrate based on network conditions (adaptive bitrate)
     */
    private async adjustBitrateIfNeeded(): Promise<void> {
        if (!this.adaptiveBitrateEnabled || this.role !== 'host' || !this.videoSender) {
            return;
        }

        // Respect cooldown period to prevent oscillation
        const now = Date.now();
        if (now - this.lastBitrateAdjustment < ADAPTIVE_BITRATE_CONFIG.adjustmentCooldownMs) {
            return;
        }

        // Add current samples to rolling window
        this.latencySamples.push(this.connectionQuality.latency);
        this.packetLossSamples.push(this.connectionQuality.packetLoss);
        this.jitterSamples.push(this.connectionQuality.jitter);

        // Keep only recent samples
        const windowSize = ADAPTIVE_BITRATE_CONFIG.sampleWindow;
        if (this.latencySamples.length > windowSize) {
            this.latencySamples.shift();
            this.packetLossSamples.shift();
            this.jitterSamples.shift();
        }

        // Need enough samples before adjusting
        if (this.latencySamples.length < windowSize) {
            return;
        }

        // Calculate averages
        const avgLatency = this.latencySamples.reduce((a, b) => a + b, 0) / windowSize;
        const avgPacketLoss = this.packetLossSamples.reduce((a, b) => a + b, 0) / windowSize;
        const avgJitter = this.jitterSamples.reduce((a, b) => a + b, 0) / windowSize;

        // Update connection quality with averages for stability
        const previousQuality = this.connectionQuality.networkQuality;
        this.connectionQuality.networkQuality = this.calculateNetworkQuality();

        // Calculate target bitrate based on network quality
        const multiplier = ADAPTIVE_BITRATE_CONFIG.bitrateMultipliers[this.connectionQuality.networkQuality];
        const newBitrate = Math.round(this.connectionQuality.targetBitrate * multiplier * 10) / 10;

        // Only adjust if bitrate actually changed
        if (Math.abs(newBitrate - this.connectionQuality.currentBitrate) < 0.5) {
            return;
        }

        // Log quality changes
        if (previousQuality !== this.connectionQuality.networkQuality) {
            console.log(`[WebRTC] Network quality changed: ${previousQuality} → ${this.connectionQuality.networkQuality}`);
            console.log(`[WebRTC]   Avg Latency: ${avgLatency.toFixed(1)}ms, Packet Loss: ${avgPacketLoss.toFixed(1)}%, Jitter: ${avgJitter.toFixed(1)}ms`);
        }

        // Apply new bitrate via RTCRtpSender parameters
        try {
            const params = this.videoSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }

            const bitrateKbps = newBitrate * 1000 * 1000; // Convert Mbps to bps
            params.encodings[0].maxBitrate = bitrateKbps;

            await this.videoSender.setParameters(params);

            console.log(`[WebRTC] Adaptive bitrate: ${this.connectionQuality.currentBitrate}Mbps → ${newBitrate}Mbps (${this.connectionQuality.networkQuality})`);
            this.connectionQuality.currentBitrate = newBitrate;
            this.lastBitrateAdjustment = now;
        } catch (error) {
            console.error('[WebRTC] Failed to adjust bitrate:', error);
        }
    }

    /**
     * Set codec preferences to prioritize H.264 hardware encoding
     */
    private setCodecPreferences(): void {
        if (!this.peerConnection) return;

        try {
            const transceivers = this.peerConnection.getTransceivers();
            const videoTransceiver = transceivers.find(t => t.sender.track?.kind === 'video');

            if (videoTransceiver && typeof RTCRtpSender.getCapabilities === 'function') {
                const capabilities = RTCRtpSender.getCapabilities('video');
                if (capabilities?.codecs) {
                    // Prioritize codecs: H.264 > VP9 > VP8
                    const preferredOrder = ['H264', 'VP9', 'VP8', 'AV1'];
                    const sortedCodecs = [...capabilities.codecs].sort((a, b) => {
                        const aIndex = preferredOrder.findIndex(p => a.mimeType.toUpperCase().includes(p));
                        const bIndex = preferredOrder.findIndex(p => b.mimeType.toUpperCase().includes(p));
                        const aScore = aIndex === -1 ? 999 : aIndex;
                        const bScore = bIndex === -1 ? 999 : bIndex;
                        return aScore - bScore;
                    });

                    videoTransceiver.setCodecPreferences(sortedCodecs);
                    console.log('[WebRTC] Codec preferences set. Priority: H264 > VP9 > VP8');
                }
            }
        } catch (error) {
            console.warn('[WebRTC] Could not set codec preferences (may not be supported):', error);
        }
    }

    /**
     * Apply aggressive low-latency encoder settings
     * This sets maxFramerate, scalabilityMode, and priority for minimal delay
     */
    private async applyLowLatencyEncoderSettings(): Promise<void> {
        if (!this.videoSender) return;

        try {
            // Small delay to let sender initialize
            await new Promise(resolve => setTimeout(resolve, 100));

            const params = this.videoSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }

            const encoding = params.encodings[0];

            // === AGGRESSIVE LOW LATENCY SETTINGS ===

            // 1. Enforce max frame rate from settings
            encoding.maxFramerate = this.settings.fps;

            // 2. Set maximum bitrate
            encoding.maxBitrate = this.settings.bitrate * 1000 * 1000; // Mbps to bps

            // 3. Set priority to high for this stream
            encoding.priority = 'high';
            encoding.networkPriority = 'high';

            // 4. L1T1 scalability mode - no temporal layers = lower latency
            // This disables B-frames and temporal scalability
            if ('scalabilityMode' in encoding || true) {
                (encoding as any).scalabilityMode = 'L1T1';
            }

            await this.videoSender.setParameters(params);

            console.log('[WebRTC] LOW LATENCY encoder settings applied:', {
                maxFramerate: this.settings.fps,
                maxBitrate: `${this.settings.bitrate}Mbps`,
                priority: 'high',
                scalabilityMode: 'L1T1',
            });
        } catch (error) {
            console.warn('[WebRTC] Could not apply low-latency encoder settings:', error);
        }
    }

    /**
     * Apply audio bitrate and sample rate settings
     */
    private async applyAudioSettings(): Promise<void> {
        if (!this.audioSender) return;

        try {
            // Small delay to let sender initialize
            await new Promise(resolve => setTimeout(resolve, 100));

            const params = this.audioSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }

            const encoding = params.encodings[0];

            // Set audio bitrate from settings (convert kbps to bps)
            const audioBitrateBps = (this.settings.audioBitrate || 128) * 1000;
            encoding.maxBitrate = audioBitrateBps;

            // High priority for audio too
            encoding.priority = 'high';
            encoding.networkPriority = 'high';

            await this.audioSender.setParameters(params);

            console.log('[WebRTC] Audio settings applied:', {
                maxBitrate: `${this.settings.audioBitrate || 128}kbps`,
                priority: 'high',
            });
        } catch (error) {
            console.warn('[WebRTC] Could not apply audio settings:', error);
        }
    }

    /**
     * Get actual FPS from stats (for monitoring)
     */
    getActualFps(): number {
        return this.actualFps;
    }

    /**
     * Enable or disable adaptive bitrate
     */
    setAdaptiveBitrateEnabled(enabled: boolean): void {
        this.adaptiveBitrateEnabled = enabled;
        console.log(`[WebRTC] Adaptive bitrate ${enabled ? 'enabled' : 'disabled'}`);

        // Reset to target bitrate when disabling
        if (!enabled && this.videoSender) {
            this.resetBitrateToTarget();
        }
    }

    /**
     * Reset bitrate to the original target setting
     */
    async resetBitrateToTarget(): Promise<void> {
        if (!this.videoSender) return;

        try {
            const params = this.videoSender.getParameters();
            if (params.encodings && params.encodings.length > 0) {
                const bitrateKbps = this.connectionQuality.targetBitrate * 1000 * 1000;
                params.encodings[0].maxBitrate = bitrateKbps;
                await this.videoSender.setParameters(params);
                this.connectionQuality.currentBitrate = this.connectionQuality.targetBitrate;
                console.log(`[WebRTC] Bitrate reset to target: ${this.connectionQuality.targetBitrate}Mbps`);
            }
        } catch (error) {
            console.error('[WebRTC] Failed to reset bitrate:', error);
        }
    }

    /**
     * Get current connection quality metrics
     */
    getConnectionQuality(): ConnectionQuality {
        return { ...this.connectionQuality };
    }

    /**
     * Check if audio is available in the stream
     */
    hasAudio(): boolean {
        return this.hasAudioTrack;
    }

    /**
     * Attempt ICE restart to recover from connection issues
     */
    async attemptIceRestart(): Promise<boolean> {
        if (!this.peerConnection || this.role !== 'host') {
            console.warn('[WebRTC] ICE restart only available for host');
            return false;
        }

        try {
            console.log('[WebRTC] Attempting ICE restart...');
            const offer = await this.peerConnection.createOffer({ iceRestart: true });
            await this.peerConnection.setLocalDescription(offer);

            this.sendSignal({
                type: 'signal',
                sessionCode: this.sessionCode,
                from: this.peerId,
                payload: offer,
            });

            console.log('[WebRTC] ICE restart offer sent');
            return true;
        } catch (error) {
            console.error('[WebRTC] ICE restart failed:', error);
            return false;
        }
    }

    private setBandwidth(sdp: string, bitrateMbps: number): string {
        const bitrateKbps = bitrateMbps * 1000;

        // === LOW LATENCY SDP MODIFICATIONS ===
        let videoModifier = 'b=AS:' + bitrateKbps;

        // Advanced SDP Munging for low latency and stability
        // Add Google-specific extensions for real-time streaming
        const fmtpParams: string[] = [];

        // 1. If CBR is requested, force stable bitrate
        if (this.settings.bitrateMode === 'cbr') {
            fmtpParams.push(`x-google-min-bitrate=${Math.floor(bitrateKbps * 0.8)}`);
            fmtpParams.push(`x-google-max-bitrate=${bitrateKbps}`);
        }

        // 2. Reduce keyframe interval for faster error recovery (1000ms = 1 second)
        fmtpParams.push('x-google-max-keyframe-interval=1000');

        // 3. Start at higher bitrate for faster ramp-up
        fmtpParams.push(`x-google-start-bitrate=${Math.floor(bitrateKbps * 0.9)}`);

        if (fmtpParams.length > 0) {
            videoModifier += `\r\na=fmtp:96 ${fmtpParams.join(';')}`;
        }

        const lines = sdp.split('\n');
        const newLines = lines.map(line => line.trim());

        // 1. Set Bandwidth Line (b=AS) for video
        for (let i = 0; i < newLines.length; i++) {
            if (newLines[i].startsWith('m=video')) {
                i++;
                // Skip past existing attributes to find the best place to insert
                while (i < newLines.length && newLines[i] && (newLines[i].startsWith('i=') || newLines[i].startsWith('c=') || newLines[i].startsWith('b=') || newLines[i].startsWith('a='))) {
                    if (newLines[i].startsWith('b=AS:')) {
                        newLines.splice(i, 1);
                        i--;
                    }
                    i++;
                }
                newLines.splice(i, 0, videoModifier);
            }
        }

        // 2. Add session-level attributes for real-time (before first m= line)
        for (let i = 0; i < newLines.length; i++) {
            if (newLines[i].startsWith('m=')) {
                // Insert conference flag for real-time optimization
                newLines.splice(i, 0, 'a=x-google-flag:conference');
                break;
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
