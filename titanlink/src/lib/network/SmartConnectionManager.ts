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

export interface NativeEngine {
    startNetwork: (relayIp: string, relayPort: number, sessionId: string) => boolean;
    stopNetwork: () => void;
    onInput: (callback: (input: any) => void) => void;
    onPacket: (callback: (data: Buffer) => void) => void;
    sendControllerInput: (index: number, btn: number, lx: number, ly: number, rx: number, ry: number, lt: number, rt: number) => boolean;
}

// Native module will be loaded lazily to avoid top-level require crashes in production
let NativeNetworkClient: NativeEngine | null = null;
let nativeLoadError: Error | null = null;
let nativeLoadAttempted = false;

/**
 * Check if native module is supported on this platform
 * Currently only Windows x64 is supported
 */
function isNativeModuleSupported(): boolean {
    if (typeof process !== 'undefined' && process.platform && process.arch) {
        return process.platform === 'win32' && process.arch === 'x64';
    }
    // Fallback: detect from navigator (sandboxed Electron renderer)
    const ua = navigator.userAgent;
    return ua.includes('Windows') && (ua.includes('x64') || ua.includes('Win64') || ua.includes('WOW64'));
}

/**
 * Lazily load the native module (only when needed)
 * This prevents top-level require crashes in production builds
 */
function getNativeNetworkClient(): NativeEngine {
    // Return cached error
    if (nativeLoadError) {
        throw nativeLoadError;
    }

    // Return cached module
    if (NativeNetworkClient) {
        return NativeNetworkClient;
    }

    // Check platform support first
    if (!isNativeModuleSupported()) {
        nativeLoadError = new Error(
            `Native network module is not available on ${process.platform}-${process.arch}. ` +
            `Hardware capture requires Windows x64. The app will use WebRTC fallback.`
        );
        console.warn('[SmartConnection]', nativeLoadError.message);
        throw nativeLoadError;
    }

    // Only attempt load once
    if (nativeLoadAttempted) {
        throw new Error('Native module load already failed');
    }
    nativeLoadAttempted = true;

    try {
        if (typeof window === 'undefined' || !(window as any).require) {
            throw new Error('Native module can only be loaded in Electron renderer');
        }

        const electronRequire = (window as any).require;
        const nativeModule = 'titanlink-nvenc-cpp.node';
        const relPath = `native-cpp/build/Release/${nativeModule}`;

        // Simple ordered list of base directories to try
        const baseDirs: string[] = [];

        // Get real process from Node (not Vite's shimmed version)
        let nodeProcess: any = null;
        try { nodeProcess = electronRequire('process'); } catch (_) {}

        // Strategy 1: process.cwd() — most reliable in dev mode
        try { if (nodeProcess?.cwd) baseDirs.push(nodeProcess.cwd()); } catch (_) {}

        // Strategy 2: Electron's resourcesPath — for packaged apps
        try { if (nodeProcess?.resourcesPath) baseDirs.push(nodeProcess.resourcesPath); } catch (_) {}

        // Strategy 3: argv[1] parent dir — electron main script location
        try {
            if (nodeProcess?.argv?.[1]) {
                const path = electronRequire('path');
                baseDirs.push(path.dirname(path.resolve(nodeProcess.argv[1])));
                baseDirs.push(path.resolve(path.dirname(nodeProcess.argv[1]), '..'));
            }
        } catch (_) {}

        // Strategy 4: INIT_CWD from npm
        try { if (nodeProcess?.env?.INIT_CWD) baseDirs.push(nodeProcess.env.INIT_CWD); } catch (_) {}

        // Build all candidate paths
        const path = electronRequire('path');
        const fs = electronRequire('fs');
        const candidates = baseDirs.map((dir: string) => path.resolve(path.join(dir, relPath)));

        // Also try asar.unpacked variant for packaged apps
        if (nodeProcess?.resourcesPath) {
            candidates.push(path.resolve(path.join(nodeProcess.resourcesPath, 'app.asar.unpacked', relPath)));
        }

        // Hardcoded absolute fallback — will always work on the dev machine
        candidates.push('C:\\Users\\yoavl\\Desktop\\Parsec clone\\titanlink\\native-cpp\\build\\Release\\titanlink-nvenc-cpp.node');

        // Deduplicate
        const unique = [...new Set(candidates)];

        console.log(`[SmartConnection] Looking for native module in ${unique.length} locations:`);
        for (const p of unique) {
            let exists = false;
            try { exists = fs.existsSync(p); } catch (_) {}
            console.log(`[SmartConnection]  ${exists ? '✓' : '✗'} ${p}`);

            if (exists) {
                try {
                    const mod = electronRequire(p);
                    if (mod?.startNetwork) {
                        NativeNetworkClient = mod;
                        console.log('[SmartConnection] ✅ Loaded native engine from:', p);
                        return mod;
                    }
                    console.warn('[SmartConnection] Loaded but no startNetwork:', p);
                } catch (e) {
                    console.error('[SmartConnection] Found but load error:', p, (e as Error).message);
                }
            }
        }

        throw new Error(`Native engine not found in ${unique.length} paths`);
    } catch (error) {
        nativeLoadError = error as Error;
        console.error('[SmartConnection] ❌ Failed:', (error as Error).message);
        throw error;
    }
}

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
    connectedAt?: number;
    lastPacketAt?: number;
    bytesSent: number;
    bytesReceived: number;
}

export class SmartConnectionManager {
    /**
     * Check if the native UDP protocol is supported on this platform
     * Returns true only on Windows x64
     */
    static isSupported(): boolean {
        return isNativeModuleSupported();
    }


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

        const engine = getNativeNetworkClient() as any;

        console.log(`[SmartConnection] Connecting via native C++ UDP Transport`);
        const success = engine.startNetwork(config.relayIp, relayPort, String(config.sessionId));

        if (!success) {
            console.error('[SmartConnection] Failed to bind local UDP socket via C++ extension.');
        } else {
            console.log('[SmartConnection] C++ UDP Socket bound and connecting to RELAY');
        }

        // Native C++ engine passes ALL UDP packets for JS to handle conditionally
        if (engine.onPacket) {
            engine.onPacket((data: Buffer) => {
                this.handlePacket(data);
            });
        }

        // Host receives controller inputs from the client
        engine.onInput((input: any) => {
            if (this.onInputCallback) {
                this.onInputCallback({
                    index: input.controllerIndex,
                    buttons: input.buttons,
                    leftStickX: input.leftStickX / 32767,
                    leftStickY: input.leftStickY / 32767,
                    rightStickX: input.rightStickX / 32767,
                    rightStickY: input.rightStickY / 32767,
                    leftTrigger: input.leftTrigger / 255,
                    rightTrigger: input.rightTrigger / 255,
                    timestamp: Date.now()
                });
            }
        });

        // Force switch to RELAY as priority 1
        this.currentMode = ConnectionMode.RELAY;
        this.stats.mode = ConnectionMode.RELAY;
        this.stats.connectedAt = Date.now();

        // Keepalive logic moved to C++ or handled differently.
        // For now, we can omit startKeepAlive since the C++ engine would ideally handle it.
    }

    /**
     * Switch to relay mode
     */
    private switchToRelay(): void {
        if (this.p2pTimeout) {
            clearTimeout(this.p2pTimeout);
            this.p2pTimeout = undefined;
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
        try {
            const engine = getNativeNetworkClient() as any;
            if (engine?.sendVideoFrame) {
                engine.sendVideoFrame(frameNumber, codec, isKeyframe, frameData);
            }
        } catch (_) {
            // Native engine not available — frame will be dropped
        }
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
        try {
            const engine = getNativeNetworkClient() as any;
            if (engine.sendControllerInput) {
                engine.sendControllerInput(
                    controllerIndex,
                    buttons,
                    leftStickX,
                    leftStickY,
                    rightStickX,
                    rightStickY,
                    leftTrigger,
                    rightTrigger
                );
            }
            this.stats.bytesSent += 38; // approx input packet size
            this.stats.lastPacketAt = Date.now();
        } catch (e) {
            console.error('[SmartConnection] Not connected or engine error', e);
        }
    }

    // getActiveClient removed

    /**
     * Start keep-alive heartbeat (every 5 seconds)
     */
    private startKeepAlive(): void {
        // Ideally handled by native engine
        this.keepAliveInterval = setInterval(() => {
            // Keep alive dummy
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

        try {
            const engine = getNativeNetworkClient() as any;
            if (engine.stopNetwork) engine.stopNetwork();
        } catch (e) {
            // Unloaded.
        }

        this.currentMode = ConnectionMode.DISCONNECTED;
        this.stats.mode = ConnectionMode.DISCONNECTED;

        console.log('[SmartConnection] Disconnected Native C++ UDP Transport');
    }

    public onFrame(callback: (frame: any) => void): void {
        this.onFrameCallback = callback;
    }

    public onInput(callback: (input: any) => void): void {
        this.onInputCallback = callback;
    }

    private packetCount = 0;

    private handlePacket(data: Buffer): void {
        this.packetCount++;
        // Log first 10 packets and then every 100th to confirm relay is forwarding
        if (this.packetCount <= 10 || this.packetCount % 100 === 0) {
            console.log(`[SmartConnection] Packet #${this.packetCount} received, size=${data.length}`);
        }

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
                this.stats.lastPacketAt = Date.now();
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
