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

        return isDev
            ? path.join(app.getAppPath(), 'native', binaryName)
            : path.join(process.resourcesPath, 'bin/titanlink-capture.node');
    }

    private loadNativeAddon(): void {
        const binaryPath = this.getBinaryPath();
        console.log(`${LOG_PREFIX} Loading from: ${binaryPath}`);

        if (!fs.existsSync(binaryPath)) {
            console.error(`${LOG_PREFIX} Native addon not found at: ${binaryPath}`);
            return;
        }

        try {
            this.native = require(binaryPath);
            console.log(`${LOG_PREFIX} ${this.native.healthCheck()}`);
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to load:`, e);
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
