/**
 * WebCodecs Decoder - Hardware-accelerated H.264 decoding
 */

const H264_BASELINE_CODEC = 'avc1.42E01F'; // Baseline Profile, Level 3.1
const FPS_UPDATE_INTERVAL_MS = 1000;

export class WebCodecsDecoder {
    private decoder: VideoDecoder | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isConfigured = false;
    private frameCount = 0;
    private lastRenderTime = 0;
    private onFpsUpdate?: (fps: number) => void;

    constructor(canvas: HTMLCanvasElement, onFpsUpdate?: (fps: number) => void) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        this.onFpsUpdate = onFpsUpdate;
        this.initDecoder();
    }

    private initDecoder(): void {
        if (!('VideoDecoder' in window)) {
            console.error('[WebCodecs] VideoDecoder not supported');
            return;
        }

        this.decoder = new VideoDecoder({
            output: (frame) => this.renderFrame(frame),
            error: (e) => console.error('[WebCodecs] Decode error:', e),
        });
    }

    private async configure(width: number, height: number): Promise<void> {
        if (!this.decoder) return;

        const config: VideoDecoderConfig = {
            codec: H264_BASELINE_CODEC,
            hardwareAcceleration: 'prefer-hardware',
            optimizeForLatency: true,
        };

        try {
            const { supported } = await VideoDecoder.isConfigSupported(config);
            if (!supported) {
                console.error('[WebCodecs] Config not supported');
                return;
            }

            this.decoder.configure(config);
            this.isConfigured = true;
            console.log(`[WebCodecs] Configured: ${width}x${height}`);
        } catch (e) {
            console.error('[WebCodecs] Configure failed:', e);
        }
    }

    public decode(frame: { frameNumber: number; timestampUs: bigint; isKeyframe: boolean; data: Uint8Array }): void {
        if (!this.decoder) return;

        if (!this.isConfigured) {
            this.configure(1920, 1080);
        }

        try {
            const chunk = new EncodedVideoChunk({
                type: frame.isKeyframe ? 'key' : 'delta',
                timestamp: Number(frame.timestampUs),
                data: frame.data,
            });
            this.decoder.decode(chunk);
        } catch (e) {
            console.error('[WebCodecs] Decode chunk failed:', e);
        }
    }

    private renderFrame(frame: VideoFrame): void {
        if (!this.ctx || !this.canvas) {
            frame.close();
            return;
        }

        this.updateCanvasSize(frame);
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        this.updateFpsCounter();
        frame.close();
    }

    private updateCanvasSize(frame: VideoFrame): void {
        if (!this.canvas) return;
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
        }
    }

    private updateFpsCounter(): void {
        this.frameCount++;
        const now = performance.now();
        const elapsed = now - this.lastRenderTime;

        if (elapsed >= FPS_UPDATE_INTERVAL_MS) {
            const fps = Math.round((this.frameCount * 1000) / elapsed);
            this.onFpsUpdate?.(fps);
            this.frameCount = 0;
            this.lastRenderTime = now;
        }
    }

    public destroy(): void {
        if (this.decoder?.state !== 'closed') {
            this.decoder?.close();
        }
        this.decoder = null;
        this.isConfigured = false;
    }
}
