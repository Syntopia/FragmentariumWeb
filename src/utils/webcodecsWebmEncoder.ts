import { buildWebmBlob, type WebmCodecId, type WebmEncodedVideoChunk } from "./webmMuxer";

export type WebCodecsMovieCodec = "vp9" | "vp8";

export interface WebCodecsMovieOptions {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  keyframeInterval: number;
  codec: WebCodecsMovieCodec;
}

export interface WebCodecsSupportResult {
  supported: boolean;
  reason: string | null;
  config: VideoEncoderConfig | null;
}

function codecString(codec: WebCodecsMovieCodec): string {
  if (codec === "vp8") {
    return "vp8";
  }
  return "vp09.00.10.08";
}

function codecId(codec: WebCodecsMovieCodec): WebmCodecId {
  return codec === "vp8" ? "V_VP8" : "V_VP9";
}

export function isWebCodecsMovieExportAvailable(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

export function buildWebCodecsVideoEncoderConfig(options: WebCodecsMovieOptions): VideoEncoderConfig {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const fps = Math.max(1, Math.round(options.fps));
  const bitrate = Math.max(100_000, Math.round(options.bitrateMbps * 1_000_000));

  return {
    codec: codecString(options.codec),
    width,
    height,
    framerate: fps,
    bitrate,
    bitrateMode: "variable",
    latencyMode: "quality"
  };
}

export async function checkWebCodecsMovieSupport(
  options: WebCodecsMovieOptions
): Promise<WebCodecsSupportResult> {
  if (!isWebCodecsMovieExportAvailable()) {
    return {
      supported: false,
      reason: "WebCodecs (VideoEncoder/VideoFrame) is unavailable in this browser.",
      config: null
    };
  }

  const config = buildWebCodecsVideoEncoderConfig(options);
  try {
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) {
      return {
        supported: false,
        reason: `Codec configuration not supported (${config.codec}).`,
        config: null
      };
    }
    return {
      supported: true,
      reason: null,
      config: support.config ?? null
    };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
      config: null
    };
  }
}

export class WebCodecsWebmEncoder {
  private readonly options: WebCodecsMovieOptions;

  private readonly encodedChunks: WebmEncodedVideoChunk[] = [];

  private readonly encoder: VideoEncoder;

  private closed = false;

  private readonly config: VideoEncoderConfig;

  constructor(options: WebCodecsMovieOptions, config?: VideoEncoderConfig) {
    if (!isWebCodecsMovieExportAvailable()) {
      throw new Error("WebCodecs is unavailable in this browser.");
    }
    this.options = {
      width: Math.max(1, Math.round(options.width)),
      height: Math.max(1, Math.round(options.height)),
      fps: Math.max(1, Math.round(options.fps)),
      bitrateMbps: Math.max(0.1, options.bitrateMbps),
      keyframeInterval: Math.max(1, Math.round(options.keyframeInterval)),
      codec: options.codec
    };
    this.config = config ?? buildWebCodecsVideoEncoderConfig(this.options);

    this.encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.encodedChunks.push({
          timestampUs: chunk.timestamp,
          durationUs: chunk.duration ?? Math.round(1_000_000 / this.options.fps),
          keyFrame: chunk.type === "key",
          data
        });
      },
      error: (error) => {
        console.error(`[webcodecs] VideoEncoder error: ${error.message}`);
      }
    });

    this.encoder.configure(this.config);
  }

  get encodeQueueSize(): number {
    return this.encoder.encodeQueueSize;
  }

  async encodeCanvasFrame(canvas: HTMLCanvasElement, frameIndex: number): Promise<void> {
    this.ensureOpen();

    const fps = this.options.fps;
    const timestampUs = Math.round((frameIndex * 1_000_000) / fps);
    const durationUs = Math.round(1_000_000 / fps);
    const keyframeInterval = this.options.keyframeInterval;
    const keyFrame = frameIndex === 0 || frameIndex % keyframeInterval === 0;

    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: durationUs
    });
    try {
      this.encoder.encode(frame, { keyFrame });
    } finally {
      frame.close();
    }

    if (this.encoder.encodeQueueSize > 4) {
      await this.encoder.flush();
    }
  }

  async flush(): Promise<void> {
    this.ensureOpen();
    await this.encoder.flush();
  }

  async finalizeBlob(): Promise<Blob> {
    this.ensureOpen();
    await this.encoder.flush();
    this.encoder.close();
    this.closed = true;
    return buildWebmBlob({
      width: this.options.width,
      height: this.options.height,
      fps: this.options.fps,
      codecId: codecId(this.options.codec),
      chunks: this.encodedChunks,
      appName: "Fragmentarium Web (WebCodecs)"
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    try {
      this.encoder.close();
    } catch {
      // explicit best effort close
    }
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("WebCodecs encoder is already closed.");
    }
  }
}
