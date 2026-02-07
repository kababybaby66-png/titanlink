/**
 * UDP Stream Service - Replaces WebRTC with Custom UDP Protocol
 * Handles all streaming operations using TitanLink's custom protocol
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

// Signaling is still needed for session exchange
import { CONFIG } from '../config';
const SIGNALING_SERVER = CONFIG.SIGNALING.URL;

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
    private ws: WebSocket | null = null;
    private connectionManager: SmartConnectionManager | null = null;
    private callbacks: UDPServiceCallbacks | null = null;

    // Session info
    private sessionCode: string = '';
    private sessionId: string = '';
    private role: 'host' | 'client' | null = null;
    private isConnected: boolean = false;

    // Settings
    private settings: StreamSettings = DEFAULT_SETTINGS;

    // Oracle relay server (will be replaced with your actual Oracle VM IP)
    private relayServerIp: string = '127.0.0.1'; // Localhost for testing, change to Oracle IP
    private relayServerPort: number = 5000;

    // Hardware capture integration
    private captureInterval: NodeJS.Timeout | null = null;
    private frameNumber: number = 0;

    constructor() {
        console.log('[UDPStreamService] Initialized with custom UDP protocol');
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

        // Connect to signaling to await client
        await this.connectToSignaling();

        // Create session on signaling server
        await this.createSession();

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

        // Connect to signaling
        await this.connectToSignaling();

        // Join session
        await this.joinSession();

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
        this.callbacks.onStateChange('connected');
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

        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }

        if (this.connectionManager) {
            this.connectionManager.disconnect();
            this.connectionManager = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
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
        this.settings = { ...this.settings, ...settings };
        console.log('[UDPStreamService] Settings updated:', this.settings);
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
        // Generate a unique 8-byte session ID
        return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString();
    }

    private async connectToSignaling(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(SIGNALING_SERVER);

            this.ws.onopen = () => {
                console.log('[UDPStreamService] Connected to signaling server');
                resolve();
            };

            this.ws.onerror = (error) => {
                console.error('[UDPStreamService] Signaling error:', error);
                reject(error);
            };

            this.ws.onmessage = this.handleSignalingMessage.bind(this);
        });
    }

    private async createSession(): Promise<void> {
        if (!this.ws) {
            throw new Error('Signaling not connected');
        }

        // Generate a unique host ID
        const hostId = `host-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        this.ws.send(JSON.stringify({
            type: 'create-session',
            sessionCode: this.sessionCode,
            sessionId: this.sessionId, // Send sessionId for relay to clients
            hostId: hostId,
        }));
    }

    private async joinSession(): Promise<void> {
        if (!this.ws) {
            throw new Error('Signaling not connected');
        }

        const ws = this.ws; // Capture reference for closure

        return new Promise((resolve, reject) => {
            // Generate a unique client ID
            const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

            let timeout: ReturnType<typeof setTimeout>;

            // Set up one-time handler for the response
            const handleResponse = (event: MessageEvent) => {
                try {
                    const message = JSON.parse(event.data);

                    if (message.type === 'session-joined') {
                        this.sessionId = message.data.sessionId;
                        console.log('[UDPStreamService] Joined session, received sessionId:', this.sessionId);
                        ws.removeEventListener('message', handleResponse);
                        clearTimeout(timeout);
                        resolve();
                    } else if (message.type === 'session-not-found') {
                        ws.removeEventListener('message', handleResponse);
                        clearTimeout(timeout);
                        reject(new Error('Session not found'));
                    } else if (message.type === 'error') {
                        ws.removeEventListener('message', handleResponse);
                        clearTimeout(timeout);
                        const errorMsg = typeof message.data === 'string'
                            ? message.data
                            : (message.data?.message || 'Unknown error');
                        reject(new Error(errorMsg));
                    }
                    // Other message types are handled by handleSignalingMessage
                } catch (error) {
                    // Ignore parse errors for other messages
                }
            };

            ws.addEventListener('message', handleResponse);

            // Set a timeout for join response
            timeout = setTimeout(() => {
                ws.removeEventListener('message', handleResponse);
                reject(new Error('Join session timeout'));
            }, 10000);

            ws.send(JSON.stringify({
                type: 'join-session',
                sessionCode: this.sessionCode,
                clientId: clientId,
            }));
        });
    }

    private handleSignalingMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'session-created':
                    console.log('[UDPStreamService] Session created, waiting for client...');
                    break;

                case 'peer-joined':
                    if (this.role === 'host') {
                        this.handleClientJoined(message.data);
                    }
                    break;

                case 'session-joined':
                    if (this.role === 'client') {
                        this.sessionId = message.data.sessionId;
                    }
                    break;

                case 'peer-left':
                case 'host-left':
                    if (this.callbacks) {
                        this.callbacks.onPeerDisconnected();
                    }
                    this.disconnect();
                    break;

                case 'error':
                    if (this.callbacks) {
                        const errorMsg = typeof message.data === 'string'
                            ? message.data
                            : (message.data?.message || 'Unknown error');
                        this.callbacks.onError(errorMsg);
                    }
                    break;
            }
        } catch (error) {
            console.error('[UDPStreamService] Failed to handle signaling message:', error);
        }
    }

    private async handleClientJoined(clientInfo: any): Promise<void> {
        console.log('[UDPStreamService] Client joined:', clientInfo);

        if (!this.connectionManager) {
            return;
        }

        // Connect via relay (P2P could be added later with client's IP)
        await this.connectionManager.connect({
            sessionId: this.sessionId,
            relayIp: this.relayServerIp,
            relayPort: this.relayServerPort,
        });

        this.isConnected = true;

        if (this.callbacks) {
            this.callbacks.onPeerConnected({
                peerId: clientInfo.clientId || 'client',
                username: 'Client',
                connectedAt: Date.now(),
            });
        }

        console.log('[UDPStreamService] Host connected via', this.connectionManager.getMode());
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
                });

                if (started) {
                    console.log('[UDPStreamService] Hardware capture started via electronAPI');

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

    private handleEncodedFrame(frame: {
        frameNumber: number;
        timestampUs: number;
        isKeyframe: boolean;
        data: Buffer;
    }): void {
        if (!this.connectionManager || !this.isConnected) {
            return;
        }

        try {
            this.connectionManager.sendVideoFrame(
                frame.frameNumber,
                1, // H264 codec
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

    // encodeButtons method removed - input.buttons is already a bitfield
}

// Export singleton instance
export const udpStreamService = new UDPStreamService();
