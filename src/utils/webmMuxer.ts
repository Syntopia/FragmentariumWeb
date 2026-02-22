export type WebmCodecId = "V_VP8" | "V_VP9";

export interface WebmEncodedVideoChunk {
  timestampUs: number;
  durationUs: number;
  keyFrame: boolean;
  data: Uint8Array;
}

export interface BuildWebmOptions {
  width: number;
  height: number;
  fps: number;
  codecId: WebmCodecId;
  chunks: WebmEncodedVideoChunk[];
  appName?: string;
}

const MAX_CLUSTER_TIME_SPAN_MS = 30_000;
const TIMECODE_SCALE_NS = 1_000_000; // 1 ms time units

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeUnsigned(valueRaw: number, minBytes = 1): Uint8Array {
  if (!Number.isFinite(valueRaw) || valueRaw < 0) {
    throw new Error(`Invalid unsigned EBML value: ${valueRaw}`);
  }
  const value = Math.floor(valueRaw);
  let bytes = Math.max(1, minBytes);
  while (value >= 2 ** (bytes * 8) && bytes < 8) {
    bytes += 1;
  }
  const out = new Uint8Array(bytes);
  let remaining = value;
  for (let i = bytes - 1; i >= 0; i -= 1) {
    out[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

function encodeFloat64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function encodeSizeVint(size: number): Uint8Array {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Invalid EBML size: ${size}`);
  }
  for (let width = 1; width <= 8; width += 1) {
    const payloadBits = 7 * width;
    const maxValue = width === 8 ? Number.MAX_SAFE_INTEGER : 2 ** payloadBits - 2;
    if (size <= maxValue) {
      const out = new Uint8Array(width);
      let remaining = size;
      for (let i = width - 1; i >= 0; i -= 1) {
        out[i] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      out[0] |= 1 << (8 - width);
      return out;
    }
  }
  throw new Error(`EBML size too large: ${size}`);
}

function element(id: number[], data: Uint8Array): Uint8Array {
  return concatBytes([Uint8Array.from(id), encodeSizeVint(data.length), data]);
}

function uintElement(id: number[], value: number, minBytes = 1): Uint8Array {
  return element(id, encodeUnsigned(value, minBytes));
}

function floatElement(id: number[], value: number): Uint8Array {
  return element(id, encodeFloat64(value));
}

function stringElement(id: number[], value: string): Uint8Array {
  return element(id, encodeUtf8(value));
}

function blockTimecodeBytes(relativeTimeMs: number): Uint8Array {
  if (!Number.isInteger(relativeTimeMs) || relativeTimeMs < -32768 || relativeTimeMs > 32767) {
    throw new Error(`SimpleBlock timecode out of range: ${relativeTimeMs}`);
  }
  const out = new Uint8Array(2);
  new DataView(out.buffer).setInt16(0, relativeTimeMs, false);
  return out;
}

function simpleBlock(trackNumber: number, relativeTimeMs: number, keyFrame: boolean, payload: Uint8Array): Uint8Array {
  if (trackNumber !== 1) {
    throw new Error("Only track number 1 is currently supported.");
  }
  const trackVint = new Uint8Array([0x81]); // track 1
  const timecode = blockTimecodeBytes(relativeTimeMs);
  const flags = new Uint8Array([keyFrame ? 0x80 : 0x00]);
  return element([0xa3], concatBytes([trackVint, timecode, flags, payload]));
}

interface ClusterChunk {
  absoluteTimeMs: number;
  relativeTimeMs: number;
  keyFrame: boolean;
  data: Uint8Array;
}

interface ClusterData {
  timecodeMs: number;
  blocks: ClusterChunk[];
}

function buildClusters(chunks: WebmEncodedVideoChunk[]): ClusterData[] {
  const sorted = [...chunks].sort((a, b) => a.timestampUs - b.timestampUs);
  const clusters: ClusterData[] = [];
  let current: ClusterData | null = null;

  for (const chunk of sorted) {
    const absoluteTimeMs = Math.max(0, Math.round(chunk.timestampUs / 1000));
    if (
      current === null ||
      absoluteTimeMs - current.timecodeMs > MAX_CLUSTER_TIME_SPAN_MS ||
      absoluteTimeMs - current.timecodeMs > 32767
    ) {
      current = {
        timecodeMs: absoluteTimeMs,
        blocks: []
      };
      clusters.push(current);
    }

    current.blocks.push({
      absoluteTimeMs,
      relativeTimeMs: absoluteTimeMs - current.timecodeMs,
      keyFrame: chunk.keyFrame,
      data: chunk.data
    });
  }

  return clusters;
}

function buildEbmlHeader(): Uint8Array {
  return element(
    [0x1a, 0x45, 0xdf, 0xa3],
    concatBytes([
      uintElement([0x42, 0x86], 1),
      uintElement([0x42, 0xf7], 1),
      uintElement([0x42, 0xf2], 4),
      uintElement([0x42, 0xf3], 8),
      stringElement([0x42, 0x82], "webm"),
      uintElement([0x42, 0x87], 2),
      uintElement([0x42, 0x85], 2)
    ])
  );
}

function buildInfo(options: BuildWebmOptions): Uint8Array {
  const durationMs =
    options.chunks.length === 0
      ? 0
      : Math.max(
          ...options.chunks.map((chunk) => Math.max(0, (chunk.timestampUs + chunk.durationUs) / 1000))
        );
  const appName = options.appName ?? "Fragmentarium Web";
  return element(
    [0x15, 0x49, 0xa9, 0x66],
    concatBytes([
      uintElement([0x2a, 0xd7, 0xb1], TIMECODE_SCALE_NS, 3),
      floatElement([0x44, 0x89], durationMs),
      stringElement([0x4d, 0x80], appName),
      stringElement([0x57, 0x41], appName)
    ])
  );
}

function buildTracks(options: BuildWebmOptions): Uint8Array {
  const fps = Math.max(1, options.fps);
  const defaultDurationNs = Math.round(1_000_000_000 / fps);
  const video = element(
    [0xe0],
    concatBytes([
      uintElement([0xb0], options.width, 2),
      uintElement([0xba], options.height, 2)
    ])
  );
  const trackEntry = element(
    [0xae],
    concatBytes([
      uintElement([0xd7], 1),
      uintElement([0x73, 0xc5], 1),
      uintElement([0x83], 1), // video
      uintElement([0x9c], 0), // no lacing
      stringElement([0x86], options.codecId),
      uintElement([0x23, 0xe3, 0x83], defaultDurationNs, 4),
      video
    ])
  );
  return element([0x16, 0x54, 0xae, 0x6b], trackEntry);
}

function buildCluster(cluster: ClusterData): Uint8Array {
  const blocks = cluster.blocks.map((chunk) =>
    simpleBlock(1, chunk.relativeTimeMs, chunk.keyFrame, chunk.data)
  );
  return element(
    [0x1f, 0x43, 0xb6, 0x75],
    concatBytes([uintElement([0xe7], cluster.timecodeMs, 2), ...blocks])
  );
}

export function buildWebmFile(options: BuildWebmOptions): Uint8Array {
  if (options.width <= 0 || options.height <= 0) {
    throw new Error("Invalid WebM dimensions.");
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error("Invalid WebM fps.");
  }
  if (options.chunks.length === 0) {
    throw new Error("Cannot build WebM without encoded chunks.");
  }

  const ebmlHeader = buildEbmlHeader();
  const clusters = buildClusters(options.chunks).map(buildCluster);
  const segmentPayload = concatBytes([buildInfo(options), buildTracks(options), ...clusters]);
  const segment = element([0x18, 0x53, 0x80, 0x67], segmentPayload);
  return concatBytes([ebmlHeader, segment]);
}

export function buildWebmBlob(options: BuildWebmOptions): Blob {
  const bytes = buildWebmFile(options);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer as ArrayBuffer], { type: "video/webm" });
}

