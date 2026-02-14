/**
 * Smart Connection Manager (Renderer Wrapper)
 * Handles P2P connection via IPC to Main Process
 */

import { ConnectionMode } from '../../../shared/types/ipc';

// Re-export types
export { ConnectionMode };

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
    /**
     * Check if the native UDP protocol is supported on this platform
     * Always true now as it runs in Main process
     */
    static isSupported(): boolean {
        return !!(window.electronAPI && window.electronAPI.smartConnection);
    }

    private onFrameCallback?: (frame: any) => void;
    private onInputCallback?: (input: any) => void;
    private cleanupFrameListener?: () => void;
    private cleanupInputListener?: () => void;

    private cachedMode: ConnectionMode = ConnectionMode.DISCONNECTED;
    private cachedStats: ConnectionStats = {
        mode: ConnectionMode.DISCONNECTED,
        bytesSent: 0,
        bytesReceived: 0,
    };

    constructor() {
        if (!SmartConnectionManager.isSupported()) {
            console.warn('[SmartConnection] Electron API not available');
            return;
        }

        // Setup listeners
        this.cleanupFrameListener = window.electronAPI.smartConnection.onVideoFrame((frame: any) => {
            if (this.onFrameCallback) {
                this.onFrameCallback(frame);
            }
        });

        this.cleanupInputListener = window.electronAPI.smartConnection.onInput((input: any) => {
            if (this.onInputCallback) {
                this.onInputCallback(input);
            }
        });
    }

    /**
     * Connect using smart strategy (P2P with relay fallback)
     */
    async connect(config: ConnectionConfig): Promise<void> {
        console.log('[SmartConnection] Connecting via IPC...', config);
        const success = await window.electronAPI.smartConnection.connect(config);
        if (success) {
            this.cachedMode = ConnectionMode.RELAY; // Initial assumption, updated by stats
        }
    }

    /**
     * Confirm P2P connection is working
     * (Handled in Main process now, this is kept for API compatibility)
     */
    confirmP2P(): void {
        // No-op in renderer
    }

    /**
     * Send video frame (fire-and-forget)
     * DEPRECATED: Host now streams directly from HardwareCaptureService in Main
     * Kept for API compatibility but logs warning
     */
    sendVideoFrame(
        frameNumber: number,
        codec: number,
        isKeyframe: boolean,
        frameData: Buffer,
    ): void {
       // No-op. Main process handles this.
       // console.warn('[SmartConnection] sendVideoFrame called in renderer (deprecated)');
    }

    /**
     * Send controller input (reliable)
     */
    sendControllerInput(
        controllerIndex: number, // Unused in IPC, Main handles it
        buttons: number,
        leftStickX: number,
        leftStickY: number,
        rightStickX: number,
        rightStickY: number,
        leftTrigger: number,
        rightTrigger: number,
    ): void {
        const input = {
            buttons,
            leftStickX,
            leftStickY,
            rightStickX,
            rightStickY,
            leftTrigger,
            rightTrigger,
            timestamp: Date.now()
        };
        // @ts-ignore - input matches expected IPC type mostly
        window.electronAPI.smartConnection.sendInput(input);
    }

    /**
     * Get current connection mode
     */
    getMode(): ConnectionMode {
        // We should fetch this from main, but for sync access we return cached or guess
        // Ideally we should poll stats or subscribe to state changes
        return this.cachedMode;
    }

    /**
     * Get connection statistics
     */
    getStats(): ConnectionStats {
        // Return async promise in reality, but this API is sync?
        // Original was sync.
        // We can't make IPC sync.
        // So we'll return cached stats and trigger an update for next time?
        // Or change API to async.

        // For now, let's just return cached and fire-and-forget an update
        window.electronAPI.smartConnection.getStats().then((stats: any) => {
            this.cachedStats = stats;
            this.cachedMode = stats.mode;
        }).catch(() => {});

        return this.cachedStats;
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.cachedMode !== ConnectionMode.DISCONNECTED && this.cachedMode !== ConnectionMode.CONNECTING;
    }

    /**
     * Disconnect and cleanup
     */
    disconnect(): void {
        window.electronAPI.smartConnection.disconnect();
        this.cachedMode = ConnectionMode.DISCONNECTED;
        this.cachedStats.mode = ConnectionMode.DISCONNECTED;

        if (this.cleanupFrameListener) this.cleanupFrameListener();
        if (this.cleanupInputListener) this.cleanupInputListener();
    }

    public onFrame(callback: (frame: any) => void): void {
        this.onFrameCallback = callback;
    }

    public onInput(callback: (input: any) => void): void {
        this.onInputCallback = callback;
    }
}
