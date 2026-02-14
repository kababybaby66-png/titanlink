/**
 * Smart Connection Service (Main Process)
 * Handles P2P connection with automatic fallback to Oracle Relay
 * Uses native Rust module for network operations
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { ConnectionMode, GamepadInputState } from '../../shared/types/ipc';

// Define types for native module (NetworkClient)
interface NetworkClient {
    startListening(callback: (data: Buffer) => void): void;
    connect(ip: string, port: number, sessionId: string): Promise<void>;
    disconnect(): void;
    sendHandshake(): Promise<void>;
    sendKeepAlive(): void;
    sendVideoFrame(frameNumber: number, codec: number, isKeyframe: boolean, data: Buffer): void;
    sendControllerInput(
        controllerIndex: number,
        buttons: number,
        leftStickX: number,
        leftStickY: number,
        rightStickX: number,
        rightStickY: number,
        leftTrigger: number,
        rightTrigger: number
    ): void;
}

export interface ConnectionConfig {
    sessionId: string;
    peerIp?: string;
    peerPort?: number;
    relayIp: string;
    relayPort?: number;
    p2pTimeoutMs?: number;
}

export interface ConnectionStats {
    mode: ConnectionMode;
    connectedAt?: Date;
    lastPacketAt?: Date;
    bytesSent: number;
    bytesReceived: number;
}

const LOG_PREFIX = '[SmartConnectionService]';

export class SmartConnectionService extends EventEmitter {
    private nativeNet: any = null;
    private NetworkClientClass: any = null;

    private p2pClient?: NetworkClient;
    private relayClient?: NetworkClient;
    private currentMode: ConnectionMode = ConnectionMode.DISCONNECTED;
    private config?: ConnectionConfig;
    private stats: ConnectionStats;
    private p2pTimeout?: NodeJS.Timeout;
    private keepAliveInterval?: NodeJS.Timeout;

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
        super();
        this.stats = {
            mode: ConnectionMode.DISCONNECTED,
            bytesSent: 0,
            bytesReceived: 0,
        };
        this.loadNativeAddon();
    }

    private getBinaryPath(): string {
        const isDev = !app.isPackaged;
        // Rust module name
        const binaryName = `titanlink-capture.${process.platform}-${process.arch}-msvc.node`;

        if (isDev) {
            const appPath = app.getAppPath();
            const cwd = process.cwd();
            const candidates = [
                path.join(appPath, 'native', binaryName),
                path.join(appPath, '..', 'native', binaryName),
                path.join(cwd, 'native', binaryName),
                path.join(__dirname, '..', '..', 'native', binaryName)
            ];

            for (const cand of candidates) {
                if (fs.existsSync(cand)) {
                    return cand;
                }
            }
            return candidates[0];
        } else {
            return path.join(process.resourcesPath, 'native', binaryName);
        }
    }

    private loadNativeAddon(): void {
        const netPath = this.getBinaryPath();
        if (fs.existsSync(netPath)) {
            try {
                this.nativeNet = require(netPath);
                if (this.nativeNet && this.nativeNet.NetworkClient) {
                    this.NetworkClientClass = this.nativeNet.NetworkClient;
                    console.log(`${LOG_PREFIX} Native NetworkClient loaded successfully`);
                } else {
                    console.error(`${LOG_PREFIX} Native module loaded but NetworkClient not found`);
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to load native module:`, e);
            }
        } else {
            console.warn(`${LOG_PREFIX} Native module not found at ${netPath}`);
        }
    }

    public isSupported(): boolean {
        return !!this.NetworkClientClass;
    }

    public async connect(config: ConnectionConfig): Promise<boolean> {
        if (!this.NetworkClientClass) {
            console.error(`${LOG_PREFIX} Cannot connect: Native module not loaded`);
            return false;
        }

        this.config = config;
        this.currentMode = ConnectionMode.CONNECTING;

        const relayPort = config.relayPort || 5000;

        try {
            // Priority 1: Connect to Relay
            const relayClient = new this.NetworkClientClass();
            this.relayClient = relayClient;
            relayClient.startListening(this.handlePacket.bind(this));
            await relayClient.connect(config.relayIp, relayPort, config.sessionId);
            await relayClient.sendHandshake();

            console.log(`${LOG_PREFIX} Relay connection established`);

            // P2P logic can be added here if needed, keeping it simple for now as per original code structure
            // Force switch to RELAY as priority 1
            this.currentMode = ConnectionMode.RELAY;
            this.stats.mode = ConnectionMode.RELAY;
            this.stats.connectedAt = new Date();

            this.startKeepAlive();
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Connection failed:`, e);
            this.disconnect();
            return false;
        }
    }

    public disconnect(): void {
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
        console.log(`${LOG_PREFIX} Disconnected`);
    }

    public sendVideoFrame(
        frameNumber: number,
        codec: number,
        isKeyframe: boolean,
        frameData: Buffer
    ): void {
        const client = this.getActiveClient();
        if (!client) return;

        try {
            client.sendVideoFrame(frameNumber, codec, isKeyframe, frameData);
            this.stats.bytesSent += frameData.length + 24; // approx header size
            this.stats.lastPacketAt = new Date();
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to send video frame:`, e);
        }
    }

    public sendControllerInput(input: GamepadInputState): void {
        const client = this.getActiveClient();
        if (!client) return;

        try {
            client.sendControllerInput(
                0, // Controller index
                input.buttons,
                Math.round(input.leftStickX * 32767),
                Math.round(input.leftStickY * 32767),
                Math.round(input.rightStickX * 32767),
                Math.round(input.rightStickY * 32767),
                Math.round(input.leftTrigger * 255),
                Math.round(input.rightTrigger * 255)
            );
            this.stats.bytesSent += 38; // Input packet size
            this.stats.lastPacketAt = new Date();
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to send input:`, e);
        }
    }

    public getStats(): ConnectionStats {
        return { ...this.stats, mode: this.currentMode };
    }

    public getMode(): ConnectionMode {
        return this.currentMode;
    }

    public isConnected(): boolean {
        return this.currentMode !== ConnectionMode.DISCONNECTED && this.currentMode !== ConnectionMode.CONNECTING;
    }

    // Private helpers

    private getActiveClient(): NetworkClient | undefined {
        if (this.currentMode === ConnectionMode.P2P && this.p2pClient) {
            return this.p2pClient;
        }
        return this.relayClient;
    }

    private startKeepAlive(): void {
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);

        this.keepAliveInterval = setInterval(() => {
            const client = this.getActiveClient();
            if (client) {
                client.sendKeepAlive();
            }
        }, 5000);
    }

    private handlePacket(data: Buffer): void {
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
                this.stats.lastPacketAt = new Date();
                break;
        }

        this.stats.bytesReceived += data.length;
    }

    private handleVideoPacket(payload: Buffer): void {
        if (payload.length < 8) return;

        const frameNumber = payload.readUInt32BE(0);
        const flags = payload[4];
        const isKeyframe = (flags & 1) !== 0;
        const codec = payload[5];
        const totalFragments = payload[6];
        const fragmentIndex = payload[7];
        const frameData = payload.subarray(8);

        if (totalFragments <= 1) {
            this.emit('video-frame', {
                frameNumber,
                codec,
                isKeyframe,
                data: frameData,
                timestampUs: Date.now() * 1000
            });
        } else {
            // Fragment handling
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

                    this.emit('video-frame', {
                        frameNumber,
                        codec: pending.codec,
                        isKeyframe: pending.isKeyframe,
                        data: combined,
                        timestampUs: pending.timestamp
                    });
                    this.pendingFrames.delete(frameNumber);
                }
            }
        }

        // Cleanup old frames
        if (this.pendingFrames.size > 20) {
            const keys = Array.from(this.pendingFrames.keys()).sort((a, b) => a - b);
            for (let i = 0; i < keys.length - 10; i++) {
                this.pendingFrames.delete(keys[i]);
            }
        }
    }

    private handleInputPacket(payload: Buffer): void {
        if (payload.length < 13) return; // Min size for input

        const input: GamepadInputState = {
            buttons: payload.readUInt16BE(1),
            leftStickX: payload.readInt16BE(3) / 32767,
            leftStickY: payload.readInt16BE(5) / 32767,
            rightStickX: payload.readInt16BE(7) / 32767,
            rightStickY: payload.readInt16BE(9) / 32767,
            leftTrigger: payload[11] / 255,
            rightTrigger: payload[12] / 255,
            timestamp: Date.now()
        };

        this.emit('input', input);
    }
}

export const smartConnectionService = new SmartConnectionService();
