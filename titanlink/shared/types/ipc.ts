/**
 * TitanLink IPC Type Definitions
 * Type-safe communication between Renderer and Main processes
 */

// ============================================
// Connection & Session Types
// ============================================

export interface PeerInfo {
    peerId: string;
    username: string;
    connectedAt: number;
}

export type ConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'waiting-for-peer'
    | 'connected'
    | 'streaming';

export interface SessionInfo {
    sessionId: string;
    role: 'host' | 'client';
    peerInfo?: PeerInfo;
    connectionState: ConnectionState;
    latency?: number;
}

// ============================================
// Settings Types
// ============================================

export interface StreamSettings {
    resolution: '1080p' | '720p' | '1440p' | '4k';
    fps: 30 | 60 | 120 | 144 | 240;
    bitrate: number; // in Mbps
    codec: 'h264' | 'vp8' | 'vp9' | 'av1';
    // Advanced Settings
    bitrateMode: 'cbr' | 'vbr';
    audioBitrate: number; // in kbps (96-512)
    audioSampleRate: 48000 | 44100; // in Hz
    audioQualityMode: 'game' | 'voice'; // 'game' disables echo cancellation
    vsync: boolean;
    iceRestart: boolean;
}

export const DEFAULT_SETTINGS: StreamSettings = {
    resolution: '1080p',
    fps: 60,
    bitrate: 10,
    codec: 'h264',
    bitrateMode: 'cbr',
    audioBitrate: 128,
    audioSampleRate: 48000,
    audioQualityMode: 'game',
    vsync: false,
    iceRestart: true,
};

// ============================================
// System Status Types
// ============================================

export interface SystemStats {
    cpuUsage: number; // percentage 0-100
    memUsage: number; // percentage 0-100
    totalMem: number; // in GB
    freeMem: number; // in GB
}

export interface GamepadInputState {
    // Buttons (16 bits - bitfield for efficiency)
    buttons: number;

    // Axes (4 values, -1.0 to 1.0)
    leftStickX: number;
    leftStickY: number;
    rightStickX: number;
    rightStickY: number;

    // Triggers (0.0 to 1.0)
    leftTrigger: number;
    rightTrigger: number;

    // Timestamp for latency measurement
    timestamp: number;
}

// Xbox button mapping (bitfield positions)
export const XBOX_BUTTONS = {
    A: 0,
    B: 1,
    X: 2,
    Y: 3,
    LB: 4,
    RB: 5,
    BACK: 6,
    START: 7,
    LEFT_STICK: 8,
    RIGHT_STICK: 9,
    DPAD_UP: 10,
    DPAD_DOWN: 11,
    DPAD_LEFT: 12,
    DPAD_RIGHT: 13,
    GUIDE: 14,
} as const;

// ============================================
// Driver Status Types
// ============================================

export type DriverStatus =
    | 'installed'
    | 'not-installed'
    | 'checking'
    | 'error';

export interface DriverCheckResult {
    vigembus: DriverStatus;
    message?: string;
}

// ============================================
// IPC Channel Definitions
// ============================================

// Renderer -> Main (Invoke)
export interface IpcMainHandlers {
    // System
    'system:check-drivers': () => Promise<DriverCheckResult>;
    'system:install-vigembus': () => Promise<{ success: boolean; error?: string }>;
    'system:get-displays': () => Promise<DisplayInfo[]>;
    'system:get-stats': () => Promise<SystemStats>;

    // Session management
    'session:start-hosting': (displayId: string) => Promise<{ sessionCode: string }>;
    'session:stop-hosting': () => Promise<void>;
    'session:connect-to-host': (sessionCode: string) => Promise<{ success: boolean; error?: string }>;
    'session:disconnect': () => Promise<void>;

    // Controller
    'controller:create-virtual': () => Promise<{ success: boolean; error?: string }>;
    'controller:destroy-virtual': () => Promise<void>;
}

// Main -> Renderer (Events)
export interface IpcRendererEvents {
    'session:state-changed': (state: SessionInfo) => void;
    'session:peer-connected': (peer: PeerInfo) => void;
    'session:peer-disconnected': () => void;
    'session:error': (error: string) => void;
    'stream:latency-update': (latencyMs: number) => void;
    'driver:status-changed': (status: DriverCheckResult) => void;
}

// ============================================
// Display/Screen Types
// ============================================

export interface DisplayInfo {
    id: string;
    name: string;
    width: number;
    height: number;
    primary: boolean;
}

// ============================================
// WebRTC Signaling Types
// ============================================

export interface SignalMessage {
    type: 'offer' | 'answer' | 'ice-candidate';
    sessionCode: string;
    from: string;
    to?: string;
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit | null;
}

export interface SignalingServerMessage {
    type: 'joined' | 'peer-joined' | 'peer-left' | 'signal' | 'error';
    sessionCode?: string;
    peerId?: string;
    signal?: SignalMessage;
    error?: string;
}

// ============================================
// Binary Protocol for Controller Input
// ============================================

/**
 * Binary format for gamepad input (24 bytes total):
 * - bytes 0-1: buttons bitfield (uint16)
 * - bytes 2-3: leftStickX (int16, scaled from -32768 to 32767)
 * - bytes 4-5: leftStickY (int16)
 * - bytes 6-7: rightStickX (int16)
 * - bytes 8-9: rightStickY (int16)
 * - bytes 10-11: leftTrigger (uint16, 0-65535)
 * - bytes 12-13: rightTrigger (uint16)
 * - bytes 14-21: timestamp (uint64)
 */
export const GAMEPAD_PACKET_SIZE = 24;

export function encodeGamepadInput(input: GamepadInputState): ArrayBuffer {
    const buffer = new ArrayBuffer(GAMEPAD_PACKET_SIZE);
    const view = new DataView(buffer);

    view.setUint16(0, input.buttons, true);
    view.setInt16(2, Math.round(input.leftStickX * 32767), true);
    view.setInt16(4, Math.round(input.leftStickY * 32767), true);
    view.setInt16(6, Math.round(input.rightStickX * 32767), true);
    view.setInt16(8, Math.round(input.rightStickY * 32767), true);
    view.setUint16(10, Math.round(input.leftTrigger * 65535), true);
    view.setUint16(12, Math.round(input.rightTrigger * 65535), true);

    // Split timestamp into two 32-bit parts (BigInt not supported in DataView)
    const ts = input.timestamp;
    view.setUint32(14, ts >>> 0, true);
    view.setUint32(18, Math.floor(ts / 0x100000000), true);

    return buffer;
}

export function decodeGamepadInput(buffer: ArrayBuffer): GamepadInputState {
    const view = new DataView(buffer);

    const tsLow = view.getUint32(14, true);
    const tsHigh = view.getUint32(18, true);

    return {
        buttons: view.getUint16(0, true),
        leftStickX: view.getInt16(2, true) / 32767,
        leftStickY: view.getInt16(4, true) / 32767,
        rightStickX: view.getInt16(6, true) / 32767,
        rightStickY: view.getInt16(8, true) / 32767,
        leftTrigger: view.getUint16(10, true) / 65535,
        rightTrigger: view.getUint16(12, true) / 65535,
        timestamp: tsHigh * 0x100000000 + tsLow,
    };
}

// Helper to check button state from bitfield
export function isButtonPressed(buttons: number, button: keyof typeof XBOX_BUTTONS): boolean {
    return (buttons & (1 << XBOX_BUTTONS[button])) !== 0;
}

// Helper to set button in bitfield
export function setButton(buttons: number, button: keyof typeof XBOX_BUTTONS, pressed: boolean): number {
    if (pressed) {
        return buttons | (1 << XBOX_BUTTONS[button]);
    } else {
        return buttons & ~(1 << XBOX_BUTTONS[button]);
    }
}
