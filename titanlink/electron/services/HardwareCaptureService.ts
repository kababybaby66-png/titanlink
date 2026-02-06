import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

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

const LOG_PREFIX = '[HardwareCapture]';
const DEFAULT_ENCODER_SUPPORT: EncoderSupport = { nvenc: false, amf: false, quicksync: false, software: false };

export class HardwareCaptureService extends EventEmitter {
    private native: any = null;
    private isRunning = false;

    constructor() {
        super();
        this.loadNativeAddon();
    }

    private getBinaryPath(): string {
        const isDev = !app.isPackaged;
        const binaryName = `titanlink-capture.${process.platform}-${process.arch}-msvc.node`;

        if (isDev) {
            // Try common dev layouts
            const appPath = app.getAppPath();
            const candidates = [
                path.join(appPath, 'native', binaryName),
                path.join(appPath, '..', 'native', binaryName),
                path.join(process.cwd(), 'native', binaryName)
            ];

            for (const cand of candidates) {
                if (fs.existsSync(cand)) {
                    console.log(`${LOG_PREFIX} Dev mode - Found native binder at: ${cand}`);
                    return cand;
                }
            }

            console.warn(`${LOG_PREFIX} Dev mode - Could not find native binder in candidates. Defaulting to: ${candidates[0]}`);
            return candidates[0];
        } else {
            // In production, the native folder is copied to resources/native/
            return path.join(process.resourcesPath, 'native', binaryName);
        }
    }

    private loadNativeAddon(): void {
        const binaryPath = this.getBinaryPath();

        if (!fs.existsSync(binaryPath)) {
            console.error(`${LOG_PREFIX} Native addon not found at: ${binaryPath}`);
            return;
        }

        try {
            this.native = require(binaryPath);
            if (this.native && typeof this.native.healthCheck === 'function') {
                console.log(`${LOG_PREFIX} Loaded successfully: ${this.native.healthCheck()}`);
            } else {
                console.warn(`${LOG_PREFIX} Native addon loaded but missing healthCheck()`);
            }
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to load native addon:`, e);
        }
    }

    public async getEncoderSupport(): Promise<EncoderSupport> {
        if (!this.native) return DEFAULT_ENCODER_SUPPORT;
        return this.native.getEncoderSupport();
    }

    public async getDisplays(): Promise<DisplayInfo[]> {
        if (!this.native) return [];

        try {
            return this.native.getDisplays();
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to get displays:`, e);
            return [];
        }
    }

    public start(settings: CaptureSettings): boolean {
        if (!this.native || this.isRunning) return false;

        try {
            console.log(`${LOG_PREFIX} Starting on display ${settings.displayIndex}`);

            this.native.startCapture(settings, (frame: EncodedFrame) => {
                this.emit('frame', frame);
            });

            this.isRunning = true;
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Start failed:`, e);
            return false;
        }
    }

    public stop(): boolean {
        if (!this.native || !this.isRunning) return false;

        try {
            this.native.stopCapture();
            this.isRunning = false;
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Stop failed:`, e);
            return false;
        }
    }

    public isCaptureActive(): boolean {
        return this.isRunning && this.native?.isCaptureRunning();
    }
}

export const hardwareCaptureService = new HardwareCaptureService();
