import { EventEmitter } from 'events';
import path from 'path';
import { app } from 'electron';

// Define the native addon interface
interface EncoderSupport {
    nvenc: boolean;
    amf: boolean;
    quicksync: boolean;
    software: boolean;
}

interface DisplayInfo {
    index: number;
    name: string;
    width: number;
    height: number;
    isPrimary: boolean;
}

interface CaptureSettings {
    displayIndex: number;
    fps: number;
    bitrate: number;
    useHardwareEncoder: boolean;
}

interface EncodedFrame {
    frameNumber: number;
    timestampUs: bigint;
    isKeyframe: boolean;
    data: Buffer;
}

/**
 * Service to manage the native hardware-accelerated capture pipeline.
 * Wraps the titanlink-capture native addon.
 */
export class HardwareCaptureService extends EventEmitter {
    private native: any = null;
    private isRunning: boolean = false;

    constructor() {
        super();
        this.loadNativeAddon();
    }

    private loadNativeAddon() {
        try {
            // Determine path to native addon
            // In development, we use the build from native/
            // In production, it will be in the app resources
            const isDev = !app.isPackaged;

            // The NAPI build creates platform-specific binaries like:
            // titanlink-capture.win32-x64-msvc.node
            const binaryName = `titanlink-capture.${process.platform}-${process.arch}-msvc.node`;
            const binaryPath = isDev
                ? path.join(__dirname, '../../native', binaryName)
                : path.join(process.resourcesPath, 'bin/titanlink-capture.node');

            console.log(`[HardwareCapture] Loading native addon from: ${binaryPath}`);
            this.native = require(binaryPath);
            console.log(`[HardwareCapture] ${this.native.healthCheck()}`);
        } catch (e) {
            console.error('[HardwareCapture] Failed to load native addon:', e);
            console.error('[HardwareCapture] Hardware capture will be unavailable');
        }
    }

    /**
     * Check if hardware encoding is supported on this system
     */
    public async getEncoderSupport(): Promise<EncoderSupport> {
        if (!this.native) return { nvenc: false, amf: false, quicksync: false, software: false };
        return this.native.getEncoderSupport();
    }

    /**
     * List all available displays for capture
     */
    public async getDisplays(): Promise<DisplayInfo[]> {
        if (!this.native) return [];
        try {
            return this.native.getDisplays();
        } catch (e) {
            console.error('[HardwareCapture] Failed to get displays:', e);
            return [];
        }
    }

    /**
     * Start the hardware capture pipeline
     */
    public start(settings: CaptureSettings): boolean {
        if (!this.native || this.isRunning) return false;

        try {
            console.log(`[HardwareCapture] Starting capture on display ${settings.displayIndex}...`);

            this.native.startCapture(settings, (frame: EncodedFrame) => {
                // Emit the encoded frame to listeners
                this.emit('frame', frame);
            });

            this.isRunning = true;
            return true;
        } catch (e) {
            console.error('[HardwareCapture] Failed to start capture:', e);
            return false;
        }
    }

    /**
     * Stop the capture pipeline
     */
    public stop(): boolean {
        if (!this.native || !this.isRunning) return false;

        try {
            this.native.stopCapture();
            this.isRunning = false;
            return true;
        } catch (e) {
            console.error('[HardwareCapture] Failed to stop capture:', e);
            return false;
        }
    }

    /**
     * Check if capture is running
     */
    public isCaptureActive(): boolean {
        return this.isRunning && this.native?.isCaptureRunning();
    }
}

// Singleton instance
export const hardwareCaptureService = new HardwareCaptureService();
