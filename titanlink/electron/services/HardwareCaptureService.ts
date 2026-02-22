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
    codec: string;
    bitrateMode: string; // "cbr" or "vbr"
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
    private nativeNet: any = null;
    private nativeCapture: any = null;
    private isRunning = false;

    constructor() {
        super();
        this.loadNativeAddon();
    }

    private getBinaryPath(isCaptureCpp: boolean = false): string {
        const isDev = !app.isPackaged;
        let binaryName = '';

        if (isCaptureCpp) {
            binaryName = `titanlink-nvenc-cpp.node`; // C++ module name
        } else {
            // Rust module name
            binaryName = `titanlink-capture.${process.platform}-${process.arch}-msvc.node`;
        }

        console.log(`${LOG_PREFIX} === Path Resolution Debug (${isCaptureCpp ? 'C++' : 'Rust'}) ===`);
        console.log(`${LOG_PREFIX} isDev: ${isDev}`);
        console.log(`${LOG_PREFIX} binaryName: ${binaryName}`);

        if (isDev) {
            const appPath = app.getAppPath();
            const cwd = process.cwd();
            const candidates = [];

            if (isCaptureCpp) {
                // C++ module paths
                // Usually relative to electron/services is ../../native-cpp/build/Release/
                // __dirname is electron/services/ (in dist?) or services/ (in ts-node?)
                // Assuming dev mode runs from root or electron/
                candidates.push(path.join(__dirname, '..', '..', 'native-cpp', 'build', 'Release', binaryName));
                candidates.push(path.join(cwd, 'native-cpp', 'build', 'Release', binaryName));
            } else {
                // Rust module paths (existing logic)
                candidates.push(path.join(appPath, 'native', binaryName));
                candidates.push(path.join(appPath, '..', 'native', binaryName));
                candidates.push(path.join(cwd, 'native', binaryName));
                candidates.push(path.join(__dirname, '..', '..', 'native', binaryName));
            }

            console.log(`${LOG_PREFIX} Checking candidates:`);
            for (const cand of candidates) {
                const exists = fs.existsSync(cand);
                console.log(`${LOG_PREFIX}   ${exists ? '✓' : '✗'} ${cand}`);
                if (exists) {
                    return cand;
                }
            }
            // Fallback
            return candidates[0];
        } else {
            // Production
            // Assuming native-cpp node is also copied to resources/native/
            const prodPath = path.join(process.resourcesPath, 'native', binaryName);
            console.log(`${LOG_PREFIX} Production path: ${prodPath}`);
            return prodPath;
        }
    }

    private loadNativeAddon(): void {
        // Load Rust Module (Network/Audio)
        const netPath = this.getBinaryPath(false);
        if (fs.existsSync(netPath)) {
            try {
                this.nativeNet = require(netPath);
                console.log(`${LOG_PREFIX} Rust (Network) module loaded successfully`);
                if (this.nativeNet.healthCheck) {
                    console.log(`${LOG_PREFIX} Health check: ${this.nativeNet.healthCheck()}`);
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to load Rust module:`, e);
            }
        }

        // Load C++ Module (Capture/Encode)
        const capPath = this.getBinaryPath(true);
        if (fs.existsSync(capPath)) {
            try {
                this.nativeCapture = require(capPath);
                console.log(`${LOG_PREFIX} C++ (Capture) module loaded successfully`);

                // Check support
                try {
                    const support = this.nativeCapture.getEncoderSupport();
                    console.log(`${LOG_PREFIX} C++ Encoder Support:`, JSON.stringify(support));
                } catch (e) {
                    console.error(`${LOG_PREFIX} Failed check:`, e);
                }

            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to load C++ module:`, e);
            }
        } else {
            console.error(`${LOG_PREFIX} C++ module not found at ${capPath}`);
        }
    }

    public async getEncoderSupport(): Promise<EncoderSupport> {
        if (this.nativeCapture) {
            return this.nativeCapture.getEncoderSupport();
        }
        if (this.nativeNet) {
            // Fallback to Rust? Or default false
            return DEFAULT_ENCODER_SUPPORT;
        }
        return DEFAULT_ENCODER_SUPPORT;
    }

    public async getDisplays(): Promise<DisplayInfo[]> {
        if (!this.nativeCapture) return []; // Only C++ supports capture now

        try {
            return this.nativeCapture.getDisplays();
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to get displays:`, e);
            return [];
        }
    }

    public start(settings: CaptureSettings): boolean {
        if (!this.nativeCapture || this.isRunning) return false;

        try {
            console.log(`${LOG_PREFIX} Starting (C++) on display ${settings.displayIndex}`);

            this.nativeCapture.startCapture(settings, (frame: EncodedFrame) => {
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
        if (!this.nativeCapture || !this.isRunning) return false;

        try {
            this.nativeCapture.stopCapture();
            this.isRunning = false;
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Stop failed:`, e);
            return false;
        }
    }

    public isCaptureActive(): boolean {
        // C++ module might not expose isCaptureRunning, but we track locally
        return this.isRunning;
    }
    // --- Audio Capture (WASAPI loopback via C++ module) ---

    /** WASAPI loopback is always available on Windows 7+. */
    public isAudioSupported(): boolean {
        return !!this.nativeCapture && typeof this.nativeCapture.isAudioSupported === 'function'
            ? this.nativeCapture.isAudioSupported()
            : !!this.nativeCapture;
    }

    /** Start WASAPI loopback capture. Frames arrive via 'audio-frame' event. */
    public startAudio(_sampleRate: number = 48000, _quality: string = 'game'): boolean {
        if (!this.nativeCapture) {
            console.error(`${LOG_PREFIX} C++ capture module not loaded — cannot start audio`);
            return false;
        }

        console.log(`${LOG_PREFIX} Starting WASAPI loopback audio capture...`);

        try {
            const ok = this.nativeCapture.startAudioCapture((frame: any) => {
                this.emit('audio-frame', frame);
            });

            console.log(`${LOG_PREFIX} WASAPI audio capture ${ok ? 'started' : 'failed'}`);
            return ok;
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to start WASAPI audio capture:`, error);
            return false;
        }
    }

    /** Stop WASAPI loopback capture. */
    public stopAudio(): void {
        if (!this.nativeCapture) return;

        console.log(`${LOG_PREFIX} Stopping WASAPI audio capture...`);
        try {
            this.nativeCapture.stopAudioCapture();
            console.log(`${LOG_PREFIX} WASAPI audio capture stopped`);
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to stop WASAPI audio capture:`, error);
        }
    }
}

export const hardwareCaptureService = new HardwareCaptureService();
