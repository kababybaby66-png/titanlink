import { SmartConnectionManager } from '../lib/network/SmartConnectionManager';
import type {
    ConnectionState,
    PeerInfo,
    GamepadInputState,
    StreamSettings,
} from '../../shared/types/ipc';
import { DEFAULT_SETTINGS } from '../../shared/types/ipc';
import { CONFIG } from '../config';
import { WebRTCBridge } from './WebRTCBridge';

import { WebSocketSignalingClient } from './SignalingClient';

const SIGNALING_BASE = CONFIG.RELAY.SIGNALING_HTTP_BASE;

interface UDPServiceCallbacks {
    onStateChange: (state: ConnectionState) => void;
    onPeerConnected: (peer: PeerInfo) => void;
    onPeerDisconnected: () => void;
    onError: (error: string) => void;
    onLatencyUpdate?: (latencyMs: number) => void;
    onGamepadInput?: (input: GamepadInputState) => void;
    onVideoFrameReceived?: (frame: {
        frameNumber: number;
        timestampUs: bigint;
        isKeyframe: boolean;
        data: Uint8Array;
    }) => void;
}

export class UDPStreamService {
    private connectionManager: SmartConnectionManager | null = null;
    private callbacks: UDPServiceCallbacks | null = null;

    private sessionCode: string = '';
    private sessionId: string = '';
    private role: 'host' | 'client' | null = null;
    private isConnected: boolean = false;

    private wsClient: WebSocketSignalingClient | null = null;
    private pollSince: number = 0;
    private settings: StreamSettings = DEFAULT_SETTINGS;
    private relayServerIp: string = CONFIG.RELAY.IP;
    private relayServerPort: number = CONFIG.RELAY.PORT;
    private captureInterval: NodeJS.Timeout | null = null;
    private frameNumber: number = 0;
    private bytesSentInLastSecond: number = 0;
    private currentBitrateMbps: number = 0;
    private bitrateInterval: NodeJS.Timeout | null = null;
    private audioCaptureActive: boolean = false;
    private webrtcBridge: WebRTCBridge | null = null;
    private hostId: string = '';
    private currentDisplayId: string = '';
    private hostToken: string = '';

    constructor() {
        this.startBitrateTimer();
    }

    private startBitrateTimer() {
        this.bitrateInterval = setInterval(() => {
            this.currentBitrateMbps = (this.bytesSentInLastSecond * 8) / (1024 * 1024);
            this.bytesSentInLastSecond = 0;
        }, 1000);
    }

    public getOutgoingBitrate(): number {
        return this.currentBitrateMbps;
    }

    public getConnectionQuality() {
        if (!this.connectionManager || !this.isConnected) {
            return { latency: 0, packetLoss: 0, jitter: 0, networkQuality: 'excellent', hasAudio: true, bitrateMbps: 0 };
        }
        return {
            latency: 0,
            packetLoss: 0,
            jitter: 0,
            networkQuality: 'excellent',
            hasAudio: this.audioCaptureActive,
            bitrateMbps: this.currentBitrateMbps,
        };
    }

    async startHosting(
        displayId: string,
        callbacks: UDPServiceCallbacks,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _useDirect: boolean = false,
        useHardwareCapture: boolean = true,
    ): Promise<string> {
        this.callbacks = callbacks;
        this.role = 'host';
        this.sessionCode = this.generateSessionCode();
        this.sessionId = this.generateSessionId();
        this.hostId = `host-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        this.currentDisplayId = displayId;

        await this.httpCreateSession();
        this.startPollForClients();
        this.connectionManager = new SmartConnectionManager();
        await this.connectionManager.connect({
            sessionId: this.sessionId,
            relayIp: this.relayServerIp,
            relayPort: this.relayServerPort,
        });
        this.connectionManager.onInput((input) => {
            this.callbacks?.onGamepadInput?.(input);
        });
        if (useHardwareCapture) await this.startHardwareCapture(displayId);
        await this.startAudioCapture();
        this.callbacks.onStateChange('connected');
        return this.sessionCode;
    }

    async connectToHost(sessionCode: string, callbacks: UDPServiceCallbacks): Promise<void> {
        this.callbacks = callbacks;
        this.role = 'client';
        this.sessionCode = sessionCode;

        await this.httpJoinSession();
        this.connectionManager = new SmartConnectionManager();
        let clientFrameCount = 0;
        this.connectionManager.onFrame((frame) => {
            clientFrameCount++;
            if (clientFrameCount <= 5 || clientFrameCount % 60 === 0) {
                console.log(`[UDPStreamService CLIENT] Received frame #${clientFrameCount}: keyframe=${frame.isKeyframe}, size=${frame.data?.length}`);
            }
            this.callbacks?.onVideoFrameReceived?.(frame);
        });
        await this.connectionManager.connect({
            sessionId: this.sessionId,
            relayIp: this.relayServerIp,
            relayPort: this.relayServerPort,
        });
        this.isConnected = true;
        this.callbacks.onStateChange('streaming');
        this.callbacks.onPeerConnected({ peerId: 'host', username: 'Host', connectedAt: Date.now() });
        console.log('[UDPStreamService] Connected via', this.connectionManager.getMode());
    }

    async disconnect(): Promise<void> {
        this.stopPollForClients();
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }
        window.electronAPI?.hardwareCapture?.stop().catch(console.error);
        window.electronAPI?.hardwareCapture?.stopAudio().catch(console.error);
        if (this.connectionManager) {
            this.connectionManager.disconnect();
            this.connectionManager = null;
        }
        if (this.role === 'host' && this.sessionCode) {
            fetch(`${SIGNALING_BASE}/session/${this.sessionCode}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.hostToken ? { 'X-Host-Token': this.hostToken } : {}),
                },
            }).catch(() => { });
        }
        this.isConnected = false;
        if (this.wsClient) {
            this.wsClient.close();
            this.wsClient = null;
        }
        this.webrtcBridge?.destroy();
        this.webrtcBridge = null;
        this.callbacks?.onStateChange('disconnected');
    }

    sendInput(input: GamepadInputState): void {
        if (!this.connectionManager || !this.isConnected) return;
        try {
            this.connectionManager.sendControllerInput(
                0,
                input.buttons,
                Math.round(input.leftStickX * 32767),
                Math.round(input.leftStickY * 32767),
                Math.round(input.rightStickX * 32767),
                Math.round(input.rightStickY * 32767),
                Math.round(input.leftTrigger * 255),
                Math.round(input.rightTrigger * 255),
            );
        } catch (error) {
            console.error('[UDPStreamService] Failed to send input:', error);
        }
    }

    updateSettings(settings: StreamSettings): void {
        this.settings = { ...this.settings, ...settings };
    }

    getSessionCode(): string { return this.sessionCode; }
    getRole(): 'host' | 'client' | null { return this.role; }

    private generateSessionCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map(b => chars[b % chars.length]).join('');
    }

    private generateSessionId(): string {
        // Must be a numeric string parseable as u64 by the native Rust module
        // u64 max = 18446744073709551615 (20 digits)
        // Generate a random 18-digit number to stay safely within u64 range
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        // Use first 7 bytes (56 bits) to build a large numeric value
        let n = BigInt(0);
        for (let i = 0; i < 7; i++) {
            n = (n << BigInt(8)) | BigInt(bytes[i]);
        }
        // Ensure it's always at least 10 digits (add a base offset)
        n = n + BigInt(1_000_000_000);
        return n.toString();
    }

    private async httpCreateSession(): Promise<void> {
        const hostId = this.hostId;
        const res = await fetch(`${SIGNALING_BASE}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode: this.sessionCode, sessionId: this.sessionId, hostId }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({})) as { hostToken?: string };
        this.hostToken = data.hostToken || '';
    }

    private async httpJoinSession(): Promise<void> {
        const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const res = await fetch(`${SIGNALING_BASE}/session/${this.sessionCode}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId }),
        });
        if (res.status === 404) throw new Error('Session not found');
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { sessionId: string; hostId: string };
        this.sessionId = data.sessionId;
    }

    /**
     * Host: Use WebSocket to receive client-join events instantly
     */
    private startPollForClients(): void {
        this.wsClient = new WebSocketSignalingClient(SIGNALING_BASE);
        this.wsClient.onopen = () => {
            // Register this socket for this session
            if (this.wsClient) {
                // Since sending 'create-session' via wsClient does the API call + registers,
                // and we already did the API call in httpCreateSession, we just send raw register
                const ws = (this.wsClient as any).ws;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ action: 'register', sessionCode: this.sessionCode, peerId: this.hostId }));
                }
            }
        };

        this.wsClient.onmessage = async (event: any) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'peer-joined') {
                    await this.handleClientJoined(msg.data);
                }
            } catch (e) {
                console.error('[UDPStreamService] WebSocket parsing error', e);
            }
        };
    }

    private stopPollForClients(): void {
        if (this.wsClient) {
            this.wsClient.close();
            this.wsClient = null;
        }
    }


    private async handleClientJoined(clientInfo: any): Promise<void> {
        if (!this.connectionManager) return;
        this.isConnected = true;
        const clientId = clientInfo.peerId || clientInfo.clientId || 'client';
        try {
            if (!this.webrtcBridge) {
                this.webrtcBridge = new WebRTCBridge(this.sessionCode, this.hostId, {
                    fps: this.settings.fps,
                    bitrate: this.settings.bitrate,
                    resolution: this.settings.resolution,
                });
                await this.webrtcBridge.start(
                    clientId,
                    this.currentDisplayId,
                    (input: GamepadInputState) => this.callbacks?.onGamepadInput?.(input),
                );
            }
        } catch (e) {
            console.warn('[UDPStreamService] WebRTC bridge failed (client may be using UDP):', e);
        }
        this.callbacks?.onPeerConnected({ peerId: clientId, username: 'Client', connectedAt: Date.now() });
        console.log('[UDPStreamService] Host now active via', this.connectionManager.getMode());
    }

    private async startHardwareCapture(displayId: string): Promise<void> {
        try {
            if (window.electronAPI?.hardwareCapture?.start) {
                const displayIndex = parseInt(displayId) || 0;
                const started = await window.electronAPI.hardwareCapture.start({
                    displayIndex,
                    fps: this.settings.fps || 60,
                    bitrate: (this.settings.bitrate || 10) * 1_000_000,
                    useHardwareEncoder: true,
                    codec: this.settings.codec || 'h264',
                    bitrateMode: this.settings.bitrateMode || 'cbr',
                });
                if (started) {
                    window.electronAPI.hardwareCapture.onFrame((frame: any) => this.handleEncodedFrame(frame));
                    return;
                }
            }
            throw new Error('Hardware capture not available via electronAPI');
        } catch (error) {
            console.error('[UDPStreamService] Failed to start hardware capture:', error);
            this.startSimulatedCapture();
        }
    }

    private async startAudioCapture(): Promise<void> {
        try {
            if (!window.electronAPI?.hardwareCapture?.startAudio) return;
            const supported = await window.electronAPI.hardwareCapture.isAudioSupported();
            if (!supported) return;
            const started = await window.electronAPI.hardwareCapture.startAudio({
                sampleRate: this.settings.audioSampleRate || 48000,
                quality: this.settings.audioQualityMode || 'game',
            });
            if (started) {
                this.audioCaptureActive = true;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                window.electronAPI.hardwareCapture.onAudioFrame((_frame: any) => {
                    // TODO: Send audio frame over UDP
                });
            }
        } catch (e) {
            console.error('[UDPStreamService] Failed to start audio:', e);
        }
    }

    private handleEncodedFrame(frame: {
        frameNumber: number;
        timestampUs: bigint | number;
        isKeyframe: boolean;
        data: Buffer;
    }): void {
        if (!this.connectionManager || !this.isConnected) {
            if (frame.frameNumber % 30 === 0) {
                console.log(`[UDPStreamService HOST] Dropping frame #${frame.frameNumber}: cm=${!!this.connectionManager}, connected=${this.isConnected}`);
            }
            return;
        }
        let codecId = 1;
        if (this.settings.codec === 'hevc') codecId = 2;
        if (this.settings.codec === 'av1') codecId = 3;
        try {
            if (frame.frameNumber <= 5 || frame.frameNumber % 300 === 0) {
                console.log(`[UDPStreamService] Sending frame #${frame.frameNumber}: keyframe=${frame.isKeyframe}, size=${frame.data.length}, codec=${codecId}`);
            }
            this.bytesSentInLastSecond += frame.data.length;
            this.connectionManager.sendVideoFrame(frame.frameNumber, codecId, frame.isKeyframe, frame.data);
            if (this.webrtcBridge) {
                this.webrtcBridge.sendVideoFrame({
                    frameNumber: frame.frameNumber,
                    timestampUs: frame.timestampUs,
                    isKeyframe: frame.isKeyframe,
                    data: frame.data,
                });
            }
        } catch (error) {
            console.error('[UDPStreamService] Failed to send video frame:', error);
        }
    }

    private startSimulatedCapture(): void {
        this.captureInterval = setInterval(() => {
            if (!this.connectionManager || !this.isConnected) return;
            const dummyFrame = Buffer.from([0, 0, 0, 1]);
            this.connectionManager.sendVideoFrame(
                this.frameNumber++,
                1,
                this.frameNumber % 60 === 0,
                dummyFrame,
            );
        }, 1000 / (this.settings.fps || 60));
    }
}

export const udpStreamService = new UDPStreamService();
