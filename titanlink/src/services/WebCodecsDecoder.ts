/**
 * WebCodecs Decoder Service
 * Handles hardware-accelerated H.264 decoding in the browser.
 */

export class WebCodecsDecoder {
    private decoder: VideoDecoder | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isConfigured: boolean = false;
    private frameCount: number = 0;
    private lastRenderTime: number = 0;
    private onFpsUpdate?: (fps: number) => void;

    constructor(canvas: HTMLCanvasElement, onFpsUpdate?: (fps: number) => void) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        this.onFpsUpdate = onFpsUpdate;
        this.initDecoder();
    }

    private initDecoder() {
        if (!('VideoDecoder' in window)) {
            console.error('WebCodecs VideoDecoder is not supported in this browser');
            return;
        }

        this.decoder = new VideoDecoder({
            output: (frame) => this.renderFrame(frame),
            error: (e) => console.error('[WebCodecs] Decoding error:', e),
        });
    }

    private async configure(width: number, height: number) {
        if (!this.decoder) return;

        try {
            // H.264 Baseline Profile Level 3.1
            // avc1.42E01F: 
            // 42 = Baseline
            // E0 = Constraints (no B-frames)
            // 1F = Level 3.1
            const config: VideoDecoderConfig = {
                codec: 'avc1.42E01F',
                hardwareAcceleration: 'prefer-hardware',
                optimizeForLatency: true,
            };

            const support = await VideoDecoder.isConfigSupported(config);
            if (support.supported) {
                this.decoder.configure(config);
                this.isConfigured = true;
                console.log('[WebCodecs] Decoder configured for', width, 'x', height);
            } else {
                console.error('[WebCodecs] Configuration not supported:', support);
            }
        } catch (e) {
            console.error('[WebCodecs] Failed to configure decoder:', e);
        }
    }

    public decode(frame: { frameNumber: number; timestampUs: bigint; isKeyframe: boolean; data: Uint8Array }) {
        if (!this.decoder) return;

        // Auto-configure on first frame or resolution change
        // Since we don't have width/height in the frame header yet, we assume standard or let the first keyframe trigger it
        // In H.264, the SPS/PPS in the keyframe will contain the resolution.
        if (!this.isConfigured) {
            // For now, let's assume 1080p if not configured, or ideally use a config packet
            this.configure(1920, 1080);
        }

        try {
            const chunk = new EncodedVideoChunk({
                type: frame.isKeyframe ? 'key' : 'delta',
                timestamp: Number(frame.timestampUs), // Use microseconds
                data: frame.data,
            });

            this.decoder.decode(chunk);
        } catch (e) {
            console.error('[WebCodecs] Failed to decode chunk:', e);
        }
    }

    private renderFrame(frame: VideoFrame) {
        if (!this.ctx || !this.canvas) {
            frame.close();
            return;
        }

        // Update canvas size if it changed
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
        }

        // Draw frame to canvas
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);

        // Performance monitoring
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastRenderTime >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / (now - this.lastRenderTime));
            this.onFpsUpdate?.(fps);
            this.frameCount = 0;
            this.lastRenderTime = now;
        }

        // MUST close the frame to release GPU memory
        frame.close();
    }

    public destroy() {
        if (this.decoder) {
            if (this.decoder.state !== 'closed') {
                this.decoder.close();
            }
            this.decoder = null;
        }
        this.isConfigured = false;
    }
}
