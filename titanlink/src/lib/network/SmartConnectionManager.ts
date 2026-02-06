/**
 * Smart Connection Manager
 * Handles P2P connection with automatic fallback to Oracle Relay
 * 
 * Connection Strategy:
 * 1. Attempt direct P2P connection
 * 2. Simultaneously connect to relay as backup
 * 3. If P2P times out (500ms), switch to relay
 * 4. Monitor connection quality and switch as needed
 */

// NetworkClient will be available after building with: npm run build
// For now, we declare the interface locally
// Import NetworkClient from native addon
import type { NetworkClient as NetworkClientType } from '../../../native';

// Use require with absolute path for runtime loading of native module in Electron
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
const nativePath = path.join(process.cwd(), 'native');
const { NetworkClient } = require(nativePath);

// Re-export type for usage in class
type NetworkClient = NetworkClientType;

export enum ConnectionMode {
    DISCONNECTED = 'disconnected',
    P2P = 'p2p',
    RELAY = 'relay',
    CONNECTING = 'connecting',
}

export interface ConnectionConfig {
    /** Session ID (8-byte number as string) */
    sessionId: string;

    /** Peer IP address (for P2P) */
    peerIp?: string;

    /** Peer port (for P2P, default 5000) */
    peerPort?: number;

    /** Relay server IP (Oracle VM) */
    relayIp: string;

    /** Relay server port (default 5000) */
    relayPort?: number;

    /** Timeout before switching to relay (ms, default 500) */
    p2pTimeoutMs?: number;
}

export interface ConnectionStats {
    mode: ConnectionMode;
    connectedAt?: Date;
    lastPacketAt?: Date;
    bytesSent: number;
    bytesReceived: number;
}

export class SmartConnectionManager {
    private p2pClient?: NetworkClient;
    private relayClient?: NetworkClient;
    private currentMode: ConnectionMode = ConnectionMode.DISCONNECTED;
    private config?: ConnectionConfig;
    private stats: ConnectionStats;
    private p2pTimeout?: NodeJS.Timeout;
    private keepAliveInterval?: NodeJS.Timeout;

    // Callbacks
    private onFrameCallback?: (frame: any) => void;
    private onInputCallback?: (input: any) => void;

    // Reassembly
    private pendingFrames: Map<number, {
        totalFragments: number;
        receivedCount: number;
        fragments: Map<number, Buffer>;
        codec: number;
        isKeyframe: boolean;
        timestamp: number;
    }> = new Map();

    constructor() {
        this.stats = {
            mode: ConnectionMode.DISCONNECTED,
            bytesSent: 0,
            bytesReceived: 0,
        };
    }

    /**
     * Connect using smart strategy (P2P with relay fallback)
     */
    async connect(config: ConnectionConfig): Promise<void> {
        this.config = config;
        this.currentMode = ConnectionMode.CONNECTING;

        const relayPort = config.relayPort || 5000;
        const p2pTimeoutMs = config.p2pTimeoutMs || 500;

        const relayClient = new NetworkClient();
        this.relayClient = relayClient;
        relayClient.startListening(this.handlePacket.bind(this));
        await relayClient.connect(config.relayIp, relayPort, config.sessionId);
        await relayClient.sendHandshake();

        console.log('[SmartConnection] Relay connection established');

        // If peer IP provided, attempt P2P
        if (config.peerIp) {
            const peerPort = config.peerPort || 5000;
            const p2pClient = new NetworkClient();
            this.p2pClient = p2pClient;

            try {
                await p2pClient.connect(config.peerIp, peerPort, config.sessionId);
                p2pClient.startListening(this.handlePacket.bind(this));
                await p2pClient.sendHandshake();

                console.log('[SmartConnection] P2P connection attempt started');

                // Set timeout to switch to relay if P2P doesn't respond
                this.p2pTimeout = setTimeout(() => {
                    console.log('[SmartConnection] P2P timeout, switching to relay');
                    this.switchToRelay();
                }, p2pTimeoutMs);

                // Assume P2P for now (will switch if timeout)
                this.currentMode = ConnectionMode.P2P;
            } catch (error) {
                console.warn('[SmartConnection] P2P connection failed:', error);
                this.switchToRelay();
            }
        } else {
            // No peer IP, use relay from start
            this.switchToRelay();
        }

        this.stats.connectedAt = new Date();
        this.startKeepAlive();
    }

    /**
     * Switch to relay mode
     */
    private switchToRelay(): void {
        if (this.p2pTimeout) {
            clearTimeout(this.p2pTimeout);
            this.p2pTimeout = undefined;
        }

        if (this.p2pClient) {
            this.p2pClient.disconnect();
            this.p2pClient = undefined;
        }

        this.currentMode = ConnectionMode.RELAY;
        this.stats.mode = ConnectionMode.RELAY;
        console.log('[SmartConnection] Now using RELAY mode');
    }

    /**
     * Confirm P2P connection is working
     */
    confirmP2P(): void {
        if (this.currentMode === ConnectionMode.P2P && this.p2pTimeout) {
            clearTimeout(this.p2pTimeout);
            this.p2pTimeout = undefined;
            console.log('[SmartConnection] P2P connection confirmed');
        }
    }

    /**
     * Send video frame (fire-and-forget)
     */
    sendVideoFrame(
        frameNumber: number,
        codec: number,
        isKeyframe: boolean,
        frameData: Buffer,
    ): void {
        const client = this.getActiveClient();
        if (!client) {
            throw new Error('Not connected');
        }

        client.sendVideoFrame(frameNumber, codec, isKeyframe, frameData);
        this.stats.bytesSent += frameData.length + 24; // frame + header
        this.stats.lastPacketAt = new Date();
    }

    /**
     * Send controller input (reliable)
     */
    sendControllerInput(
        controllerIndex: number,
        buttons: number,
        leftStickX: number,
        leftStickY: number,
        rightStickX: number,
        rightStickY: number,
        leftTrigger: number,
        rightTrigger: number,
    ): void {
        const client = this.getActiveClient();
        if (!client) {
            throw new Error('Not connected');
        }

        client.sendControllerInput(
            controllerIndex,
            buttons,
            leftStickX,
            leftStickY,
            rightStickX,
            rightStickY,
            leftTrigger,
            rightTrigger,
        );

        this.stats.bytesSent += 38; // input packet size
        this.stats.lastPacketAt = new Date();
    }

    /**
     * Get active client (P2P or Relay)
     */
    private getActiveClient(): NetworkClient | undefined {
        if (this.currentMode === ConnectionMode.P2P && this.p2pClient) {
            return this.p2pClient;
        }
        return this.relayClient;
    }

    /**
     * Start keep-alive heartbeat (every 5 seconds)
     */
    private startKeepAlive(): void {
        this.keepAliveInterval = setInterval(() => {
            const client = this.getActiveClient();
            if (client) {
                client.sendKeepAlive();
            }
        }, 5000);
    }

    /**
     * Disconnect and cleanup
     */
    disconnect(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = undefined;
        }

        if (this.p2pTimeout) {
            clearTimeout(this.p2pTimeout);
            this.p2pTimeout = undefined;
        }

        if (this.p2pClient) {
            this.p2pClient.disconnect();
            this.p2pClient = undefined;
        }

        if (this.relayClient) {
            this.relayClient.disconnect();
            this.relayClient = undefined;
        }

        this.currentMode = ConnectionMode.DISCONNECTED;
        this.stats.mode = ConnectionMode.DISCONNECTED;

        console.log('[SmartConnection] Disconnected');
    }

    public onFrame(callback: (frame: any) => void): void {
        this.onFrameCallback = callback;
    }

    public onInput(callback: (input: any) => void): void {
        this.onInputCallback = callback;
    }

    private handlePacket(data: Buffer): void {
        // Basic Packet Parsing
        // Header is 24 bytes
        if (data.length < 24) return;

        const magic = data.readUInt32BE(8);
        if (magic !== 0xCAFEBABE) return;

        const type = data[12];
        const payload = data.subarray(24);

        switch (type) {
            case 3: // VideoFrame (Single)
            case 4: // VideoFragment
                this.handleVideoPacket(payload);
                break;
            case 5: // ControllerInput
                this.handleInputPacket(payload);
                break;
            case 6: // KeepAlive
                // Update stats
                this.stats.lastPacketAt = new Date();
                break;
        }

        this.stats.bytesReceived += data.length;
    }

    private handleVideoPacket(payload: Buffer): void {
        if (payload.length < 8) return; // Header size

        // Video payload header:
        // FrameNum (4), Flags(1), Codec(1), TotalFrags(1), FragIndex(1)
        const frameNumber = payload.readUInt32BE(0);
        const flags = payload[4];
        const isKeyframe = (flags & 1) !== 0;
        const codec = payload[5];
        const totalFragments = payload[6];
        const fragmentIndex = payload[7];
        const frameData = payload.subarray(8);

        if (totalFragments <= 1) {
            // Single packet frame
            if (this.onFrameCallback) {
                this.onFrameCallback({
                    frameNumber,
                    codec,
                    isKeyframe,
                    data: frameData,
                    timestampUs: Date.now() * 1000 // Approximate
                });
            }
        } else {
            // Fragmented frame
            let pending = this.pendingFrames.get(frameNumber);
            if (!pending) {
                pending = {
                    totalFragments,
                    receivedCount: 0,
                    fragments: new Map(),
                    codec,
                    isKeyframe,
                    timestamp: Date.now() * 1000
                };
                this.pendingFrames.set(frameNumber, pending);
            }

            if (!pending.fragments.has(fragmentIndex)) {
                pending.fragments.set(fragmentIndex, frameData);
                pending.receivedCount++;

                if (pending.receivedCount >= pending.totalFragments) {
                    // Reassemble
                    const fullSize = Array.from(pending.fragments.values()).reduce((acc, buf) => acc + buf.length, 0);
                    const combined = Buffer.allocUnsafe(fullSize);
                    let offset = 0;
                    for (let i = 0; i < pending.totalFragments; i++) {
                        const frag = pending.fragments.get(i);
                        if (frag) {
                            frag.copy(combined, offset);
                            offset += frag.length;
                        }
                    }

                    if (this.onFrameCallback) {
                        this.onFrameCallback({
                            frameNumber,
                            codec: pending.codec,
                            isKeyframe: pending.isKeyframe,
                            data: combined,
                            timestampUs: pending.timestamp
                        });
                    }
                    this.pendingFrames.delete(frameNumber);
                }
            }
        }

        // Cleanup old frames
        if (this.pendingFrames.size > 20) {
            const keys = Array.from(this.pendingFrames.keys()).sort((a, b) => a - b);
            // Remove frames older than the last 10
            for (let i = 0; i < keys.length - 10; i++) {
                this.pendingFrames.delete(keys[i]);
            }
        }
    }

    private handleInputPacket(payload: Buffer): void {
        if (this.onInputCallback) {
            // Input payload parsing
            // Index(1), Buttons(2), StickLX(2), StickLY(2), ...
            // We can just pass the raw object or parse it here
            // Let's pass a parsed object matching GamepadInputState
            // But wait, payload is binary. UDPStreamService sends raw binary.
            // Decoded in Main Process often? No, here we are in Renderer/Main context using NAPI.

            // Actually, client sends input, Host receives it.
            // Host needs to inject it.
            // Host is running `handleInputPacket`.
            const input = {
                index: payload[0],
                buttons: payload.readUInt16BE(1),
                leftStickX: payload.readInt16BE(3) / 32767,
                leftStickY: payload.readInt16BE(5) / 32767,
                rightStickX: payload.readInt16BE(7) / 32767,
                rightStickY: payload.readInt16BE(9) / 32767,
                leftTrigger: payload[11] / 255,
                rightTrigger: payload[12] / 255,
                timestamp: Date.now()
            };
            this.onInputCallback(input);
        }
    }

    /**
     * Get current connection mode
     */
    getMode(): ConnectionMode {
        return this.currentMode;
    }

    /**
     * Get connection statistics
     */
    getStats(): ConnectionStats {
        return { ...this.stats, mode: this.currentMode };
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.currentMode === ConnectionMode.P2P || this.currentMode === ConnectionMode.RELAY;
    }
}
