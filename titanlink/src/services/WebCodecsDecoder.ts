/**
 * WebCodecs Decoder - Hardware-accelerated H.264 decoding
 */

const FPS_UPDATE_INTERVAL_MS = 1000;

export class WebCodecsDecoder {
    private decoder: VideoDecoder | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isConfigured = false;
    private frameCount = 0;
    private lastRenderTime = 0;
    private onFpsUpdate?: (fps: number) => void;

    private isConfiguring = false;
    private chunkQueue: EncodedVideoChunk[] = [];

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

    // Try High Profile (6400xx), Main Profile (4d00xx), then Baseline (4200xx)
    // Level 3.1 (1F) is usually sufficient for 1080p
    private readonly CODEC_PREFERENCES = [
        'avc1.640028', // High Profile, Level 4.0 (for 1080p60)
        'avc1.4D0028', // Main Profile, Level 4.0
        'avc1.42E028', // Baseline Profile, Level 4.0
        'avc1.64001F', // High Profile, Level 3.1
        'avc1.4D001F', // Main Profile, Level 3.1
        'avc1.42E01F', // Baseline Profile, Level 3.1
    ];

    private hasReceivedKeyframe = false;

    private async configure(width: number, height: number): Promise<void> {
        if (!this.decoder || this.isConfiguring || this.isConfigured) return;

        this.isConfiguring = true;
        this.hasReceivedKeyframe = false;
        console.log(`[WebCodecs] Configuring decoder for ${width}x${height}...`);

        for (const codec of this.CODEC_PREFERENCES) {
            const config: VideoDecoderConfig = {
                codec,
                hardwareAcceleration: 'prefer-hardware',
                optimizeForLatency: true,
                codedWidth: width,
                codedHeight: height,
            };

            try {
                const { supported } = await VideoDecoder.isConfigSupported(config);
                if (supported) {
                    console.log(`[WebCodecs] Selected codec: ${codec}`);
                    this.decoder.configure(config);
                    this.isConfigured = true;
                    this.isConfiguring = false;

                    // Flush queue
                    for (const queuedChunk of this.chunkQueue) {
                        try {
                            if (!this.hasReceivedKeyframe) {
                                if (queuedChunk.type === 'key') {
                                    this.hasReceivedKeyframe = true;
                                } else {
                                    continue; // Drop frame until keyframe
                                }
                            }
                            this.decoder.decode(queuedChunk);
                        } catch (e) {
                            console.error('[WebCodecs] Queued decode failed:', e);
                        }
                    }
                    this.chunkQueue = [];
                    return;
                }
            } catch (e) {
                console.warn(`[WebCodecs] Codec ${codec} check failed:`, e);
            }
        }

        console.error('[WebCodecs] No supported H.264 codec found');
        this.isConfiguring = false;
        this.chunkQueue = []; // Clear queue on failure
    }

    public decode(frame: { frameNumber: number; timestampUs: bigint; isKeyframe: boolean; data: Uint8Array }): void {
        if (!this.decoder) return;

        try {
            const chunk = new EncodedVideoChunk({
                type: frame.isKeyframe ? 'key' : 'delta',
                timestamp: Number(frame.timestampUs),
                data: frame.data,
            });

            if (!this.isConfigured) {
                this.chunkQueue.push(chunk);
                if (!this.isConfiguring) {
                    this.configure(1920, 1080);
                }
                return;
            }

            if (!this.hasReceivedKeyframe) {
                if (chunk.type === 'key') {
                    this.hasReceivedKeyframe = true;
                } else {
                    return; // Drop delta frames until we get a keyframe
                }
            }

            this.decoder.decode(chunk);
        } catch (e) {
            console.error('[WebCodecs] Decode chunk failed:', e);
        }
    }

    private renderFrame(frame: VideoFrame): void {
        if (!this.ctx || !this.canvas) {
            console.warn('[WebCodecs] renderFrame: no ctx or canvas, dropping frame');
            frame.close();
            return;
        }

        this.updateCanvasSize(frame);
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        this.updateFpsCounter();
        if (this.frameCount <= 3) {
            console.log(`[WebCodecs] Rendered frame: ${frame.displayWidth}x${frame.displayHeight}, canvas: ${this.canvas.width}x${this.canvas.height}`);
        }
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
        this.chunkQueue = [];
    }
}
