/**
 * UDP Stream Service - Replaces WebRTC with Custom UDP Protocol
 * Handles all streaming operations using TitanLink's custom protocol
 * Signaling is done via HTTP REST — no WebSocket dependency.
 */

import { SmartConnectionManager, ConnectionMode } from '../lib/network/SmartConnectionManager';
import type {
    ConnectionState,
    PeerInfo,
    GamepadInputState,
    StreamSettings,
} from '../../shared/types/ipc';
import {
    DEFAULT_SETTINGS,
} from '../../shared/types/ipc';
import { CONFIG } from '../config';

// HTTP signaling base URL (now centralized in config.ts)
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

    // Session info
    private sessionCode: string = '';
    private sessionId: string = '';
    private role: 'host' | 'client' | null = null;
    private isConnected: boolean = false;

    // HTTP polling for peer-join events (host side)
    private pollInterval: NodeJS.Timeout | null = null;
    private pollSince: number = 0;

    // Settings
    private settings: StreamSettings = DEFAULT_SETTINGS;

    // Oracle relay server (centralized in config.ts)
    private relayServerIp: string = CONFIG.RELAY.IP;
    private relayServerPort: number = CONFIG.RELAY.PORT;

    // Hardware capture integration
    private captureInterval: NodeJS.Timeout | null = null;
    private frameNumber: number = 0;

    // Bitrate tracking
    private bytesSentInLastSecond: number = 0;
    private currentBitrateMbps: number = 0;
    private bitrateInterval: NodeJS.Timeout | null = null;
    private audioCaptureActive: boolean = false;

    constructor() {
        console.log('[UDPStreamService] Initialized with custom UDP protocol');
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
            return {
                latency: 0,
                packetLoss: 0,
                jitter: 0,
                networkQuality: 'excellent',
                hasAudio: true,
                bitrateMbps: 0
            };
        }

        const stats = this.connectionManager.getStats();
        // Since custom UDP protocol doesn't yet have dedicated ping packets for RTT,
        // we use a reasonable estimation or wait for future implementation.
        return {
            latency: 0, // Future: implement ping/pong in SmartConnectionManager
            packetLoss: 0,
            jitter: 0,
            networkQuality: 'excellent',
            hasAudio: this.audioCaptureActive,
            bitrateMbps: this.currentBitrateMbps
        };
    }

    /**
     * Start hosting a session
     */
    async startHosting(
        displayId: string,
        callbacks: UDPServiceCallbacks,
        useDirect: boolean = false,
        useHardwareCapture: boolean = true,
    ): Promise<string> {
        this.callbacks = callbacks;
        this.role = 'host';

        // Generate session credentials
        this.sessionCode = this.generateSessionCode();
        this.sessionId = this.generateSessionId();

        console.log('[UDPStreamService] Starting host with session:', this.sessionCode);
        console.log('[UDPStreamService] Active settings:', {
            fps: this.settings.fps,
            bitrate: this.settings.bitrate,
            codec: this.settings.codec,
            bitrateMode: this.settings.bitrateMode,
            resolution: this.settings.resolution,
            audioSampleRate: this.settings.audioSampleRate,
            audioBitrate: this.settings.audioBitrate,
            audioQualityMode: this.settings.audioQualityMode,
            vsync: this.settings.vsync,
            useHardwareCapture: this.settings.useHardwareCapture,
        });

        // Register session on signaling server via HTTP
        await this.httpCreateSession();

        // Start polling for client joins (every 2s)
        this.startPollForClients();

        // Initialize connection manager (will connect when client joins)
        this.connectionManager = new SmartConnectionManager();

        // Host must connect to relay to receive packets
        await this.connectionManager.connect({
            sessionId: this.sessionId,
            relayIp: this.relayServerIp,
            relayPort: this.relayServerPort,
        });

        // Handle incoming controller input
        this.connectionManager.onInput((input) => {
            if (this.callbacks && this.callbacks.onGamepadInput) {
                this.callbacks.onGamepadInput(input);
            }
        });

        // Start hardware capture if enabled
        if (useHardwareCapture) {
            await this.startHardwareCapture(displayId);
        }

        // Start audio capture (independent of video encoding method)
        await this.startAudioCapture();

        this.callbacks.onStateChange('connected');

        return this.sessionCode;
    }

    /**
     * Connect to host as client
     */
    async connectToHost(sessionCode: string, callbacks: UDPServiceCallbacks): Promise<void> {
        this.callbacks = callbacks;
        this.role = 'client';
        this.sessionCode = sessionCode;

        console.log('[UDPStreamService] Connecting to session:', sessionCode);

        // Join session via HTTP — receives sessionId synchronously
        await this.httpJoinSession();

        // Initialize connection manager
        this.connectionManager = new SmartConnectionManager();

        // Handle incoming video frames
        this.connectionManager.onFrame((frame) => {
            if (this.callbacks && this.callbacks.onVideoFrameReceived) {
                this.callbacks.onVideoFrameReceived(frame);
            }
        });

        // Wait for host connection info from signaling
        // (In simplified version, we assume relay-only for now)
        await this.connectionManager.connect({
            sessionId: this.sessionId,
            relayIp: this.relayServerIp,
            relayPort: this.relayServerPort,
        });

        this.isConnected = true;
        this.callbacks.onStateChange('streaming');
        this.callbacks.onPeerConnected({
            peerId: 'host',
            username: 'Host',
            connectedAt: Date.now(),
        });

        console.log('[UDPStreamService] Connected via', this.connectionManager.getMode());
    }

    /**
     * Disconnect from session
     */
    async disconnect(): Promise<void> {
        console.log('[UDPStreamService] Disconnecting...');

        this.stopPollForClients();

        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }

        // Stop native capture (video + audio)
        if (window.electronAPI?.hardwareCapture) {
            window.electronAPI.hardwareCapture.stop().catch(console.error);
            window.electronAPI.hardwareCapture.stopAudio().catch(console.error);
        }

        if (this.connectionManager) {
            this.connectionManager.disconnect();
            this.connectionManager = null;
        }

        // Best-effort: tell the signaling server the session is gone
        if (this.role === 'host' && this.sessionCode) {
            fetch(`${SIGNALING_BASE}/session/${this.sessionCode}`, { method: 'DELETE' })
                .catch(() => { /* ignore - server will auto-cleanup anyway */ });
        }

        this.isConnected = false;

        if (this.callbacks) {
            this.callbacks.onStateChange('disconnected');
        }
    }

    /**
     * Send gamepad input (client -> host)
     */
    sendInput(input: GamepadInputState): void {
        if (!this.connectionManager || !this.isConnected) {
            console.warn('[UDPStreamService] Cannot send input: not connected');
            return;
        }

        try {
            this.connectionManager.sendControllerInput(
                0, // Controller index (always 0 for now)
                input.buttons, // Already a bitfield
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

    /**
     * Update stream settings
     */
    updateSettings(settings: StreamSettings): void {
        const oldFps = this.settings.fps;
        this.settings = { ...this.settings, ...settings };
        console.log('[UDPStreamService] Settings updated. FPS:', oldFps, '->', this.settings.fps, '. Full settings:', this.settings);
    }

    /**
     * Get session code
     */
    getSessionCode(): string {
        return this.sessionCode;
    }

    /**
     * Get role
     */
    getRole(): 'host' | 'client' | null {
        return this.role;
    }

    // ========== Private Methods ==========

    private generateSessionCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    private generateSessionId(): string {
        return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString();
    }

    /**
     * Host: register session on the signaling server via HTTP POST
     */
    private async httpCreateSession(): Promise<void> {
        const hostId = `host-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        const res = await fetch(`${SIGNALING_BASE}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionCode: this.sessionCode,
                sessionId: this.sessionId,
                hostId,
            }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        console.log('[UDPStreamService] Session registered on signaling server:', this.sessionCode);
    }

    /**
     * Client: join existing session via HTTP POST, receive sessionId synchronously
     */
    private async httpJoinSession(): Promise<void> {
        const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        const res = await fetch(`${SIGNALING_BASE}/session/${this.sessionCode}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId }),
        });

        if (res.status === 404) {
            throw new Error('Session not found');
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as { sessionId: string; hostId: string };
        this.sessionId = data.sessionId;
        console.log('[UDPStreamService] Joined session, received sessionId:', this.sessionId);
    }

    /**
     * Host: poll for client-join events every 2s
     */
    private startPollForClients(): void {
        this.pollSince = Date.now();

        this.pollInterval = setInterval(async () => {
            try {
                const res = await fetch(
                    `${SIGNALING_BASE}/session/${this.sessionCode}?since=${this.pollSince}`
                );
                if (!res.ok) return;

                const data = await res.json() as { events: Array<{ type: string; data: any; timestamp: number }> };

                for (const event of data.events) {
                    if (event.type === 'peer-joined') {
                        this.pollSince = Math.max(this.pollSince, event.timestamp);
                        await this.handleClientJoined(event.data);
                    }
                }
            } catch {
                // Ignore transient poll failures
            }
        }, 2000);
    }

    private stopPollForClients(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }


    private async handleClientJoined(clientInfo: any): Promise<void> {
        console.log('[UDPStreamService] Client joined:', clientInfo);

        if (!this.connectionManager) {
            return;
        }

        // The host's relay connection was already established in startHosting().
        // We only need to mark the session as active and notify the UI.
        // Bug Fix: Do NOT call connectionManager.connect() again — it is already connected.
        this.isConnected = true;

        if (this.callbacks) {
            // Bug Fix: server sends `{ peerId: clientId }`, not `{ clientId: clientId }`
            this.callbacks.onPeerConnected({
                peerId: clientInfo.peerId || clientInfo.clientId || 'client',
                username: 'Client',
                connectedAt: Date.now(),
            });
        }

        console.log('[UDPStreamService] Host now active via', this.connectionManager.getMode());
    }

    private async startHardwareCapture(displayId: string): Promise<void> {
        console.log('[UDPStreamService] Starting hardware capture for display:', displayId);

        try {
            // Use electronAPI which properly handles native module loading in production
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
                    console.log(`[UDPStreamService] Hardware capture started (${this.settings.codec})`);

                    // Register frame handler
                    window.electronAPI.hardwareCapture.onFrame((frame: any) => {
                        this.handleEncodedFrame(frame);
                    });

                    return;
                }
            }

            throw new Error('Hardware capture not available via electronAPI');
        } catch (error) {
            console.error('[UDPStreamService] Failed to start hardware capture:', error);

            // Fallback to simulated frames for testing
            this.startSimulatedCapture();
        }
    }

    private async startAudioCapture(): Promise<void> {
        try {
            if (window.electronAPI?.hardwareCapture?.startAudio) {
                const supported = await window.electronAPI.hardwareCapture.isAudioSupported();
                if (supported) {
                    console.log('[UDPStreamService] Starting native audio capture...');
                    const started = await window.electronAPI.hardwareCapture.startAudio({
                        sampleRate: this.settings.audioSampleRate || 48000,
                        quality: this.settings.audioQualityMode || 'game'
                    });

                    if (started) {
                        this.audioCaptureActive = true;
                        window.electronAPI.hardwareCapture.onAudioFrame((frame: any) => {
                            // TODO: Send audio frame over UDP
                            // For now just log occasionally to verify flow
                            if (Math.random() < 0.01) {
                                // console.log('[UDPStreamService] Audio frame:', frame.data.byteLength, 'bytes');
                            }
                        });
                    }
                }
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
            return;
        }

        // Log occasionally for verification
        if (frame.frameNumber % 60 === 0) {
            console.log(`[UDPStreamService] Received frame ${frame.frameNumber} from native (size: ${frame.data.length}, key: ${frame.isKeyframe})`);
        }


        // Map codec string to ID
        // 1: H264, 2: HEVC, 3: AV1
        let codecId = 1;
        if (this.settings.codec === 'hevc') codecId = 2;
        if (this.settings.codec === 'av1') codecId = 3;

        try {
            this.bytesSentInLastSecond += frame.data.length;
            this.connectionManager.sendVideoFrame(
                frame.frameNumber,
                codecId,
                frame.isKeyframe,
                frame.data,
            );
        } catch (error) {
            console.error('[UDPStreamService] Failed to send video frame:', error);
        }
    }

    private startSimulatedCapture(): void {
        console.log('[UDPStreamService] Starting simulated capture...');

        this.captureInterval = setInterval(() => {
            if (!this.connectionManager || !this.isConnected) {
                return;
            }

            // Send dummy frame (for testing without hardware)
            const dummyFrame = Buffer.from([0, 0, 0, 1]); // NAL unit header

            this.connectionManager.sendVideoFrame(
                this.frameNumber++,
                1,
                this.frameNumber % 60 === 0, // Keyframe every 60 frames
                dummyFrame,
            );
        }, 1000 / (this.settings.fps || 60));
    }
}

// Export singleton instance
export const udpStreamService = new UDPStreamService();
