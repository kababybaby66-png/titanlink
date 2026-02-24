import type { ConnectionState, PeerInfo, GamepadInputState, StreamSettings } from '../../shared/types/ipc';

export interface UDPServiceCallbacks {
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
    onStreamReceived?: (stream: MediaStream) => void; // For WebRTC
}

export interface IStreamService {
    getOutgoingBitrate(): number;
    getConnectionQuality(): {
        latency: number;
        packetLoss: number;
        jitter: number;
        networkQuality: string;
        hasAudio: boolean;
        bitrateMbps: number;
    };
    startHosting(
        displayId: string,
        callbacks: UDPServiceCallbacks,
        useDirect?: boolean,
        useHardwareCapture?: boolean,
    ): Promise<string>;
    connectToHost(sessionCode: string, callbacks: UDPServiceCallbacks): Promise<void>;
    disconnect(): Promise<void>;
    sendInput(input: GamepadInputState): void;
    updateSettings(settings: StreamSettings): void;
    getSessionCode(): string;
    getRole(): 'host' | 'client' | null;
}

function isUdpProtocolSupported(): boolean {
    return false; // TEMPORARILY FORCE WEBRTC FOR TESTING
    return typeof process !== 'undefined' &&
        process.platform === 'win32' &&
        process.arch === 'x64';
}

let instance: IStreamService | null = null;

export async function initStreamService(): Promise<IStreamService> {
    if (!instance) {
        if (isUdpProtocolSupported()) {
            console.log('[StreamService] Loading UDP service (Windows x64)');
            const module = await import('./UDPStreamService');
            instance = module.udpStreamService;
        } else {
            console.log('[StreamService] Loading WebRTC service (Fallback)');
            const module = await import('./WebRTCStreamService');
            instance = module.webrtcService;
        }
    }
    return instance as IStreamService;
}

export function getStreamService(): IStreamService {
    if (!instance) {
        throw new Error('StreamService not initialized! Call initStreamService() first.');
    }
    return instance;
}
