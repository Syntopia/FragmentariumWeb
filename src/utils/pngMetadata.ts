const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_CHUNK_TYPE = "IHDR";
const PNG_IEND_CHUNK_TYPE = "IEND";
const PNG_ITXT_CHUNK_TYPE = "iTXt";

export const FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD = "fragmentarium-web-session-json";

interface PngChunk {
  type: string;
  data: Uint8Array;
}

function assertPngSignature(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new Error("PNG data is too short.");
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("Invalid PNG signature.");
    }
  }
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new Error("PNG parsing failed: unexpected end of data.");
  }
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function writeUint32Be(value: number): Uint8Array {
  const next = new Uint8Array(4);
  next[0] = (value >>> 24) & 0xff;
  next[1] = (value >>> 16) & 0xff;
  next[2] = (value >>> 8) & 0xff;
  next[3] = value & 0xff;
  return next;
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0 || code > 0x7f) {
      throw new Error(`Non-ASCII character in PNG chunk type/text: '${text}'.`);
    }
    bytes[i] = code;
  }
  return bytes;
}

function latin1Bytes(text: string): Uint8Array {
  if (text.length < 1 || text.length > 79) {
    throw new Error("PNG iTXt keyword must be 1-79 characters.");
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0 || code > 0xff) {
      throw new Error("PNG iTXt keyword must be Latin-1 and must not contain NUL.");
    }
    bytes[i] = code;
  }
  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  assertPngSignature(bytes);
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIend = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error("PNG parsing failed: truncated chunk header.");
    }
    const length = readUint32Be(bytes, offset);
    offset += 4;
    const typeBytes = bytes.slice(offset, offset + 4);
    offset += 4;
    const type = new TextDecoder("ascii", { fatal: true }).decode(typeBytes);
    if (offset + length + 4 > bytes.length) {
      throw new Error(`PNG parsing failed: truncated chunk '${type}'.`);
    }
    const data = bytes.slice(offset, offset + length);
    offset += length;
    const crcRead = readUint32Be(bytes, offset);
    offset += 4;
    const crcExpected = crc32(concatBytes([typeBytes, data]));
    if (crcRead !== crcExpected) {
      throw new Error(`PNG parsing failed: CRC mismatch in chunk '${type}'.`);
    }

    if (!sawIhdr) {
      if (type !== PNG_IHDR_CHUNK_TYPE) {
        throw new Error("PNG parsing failed: first chunk is not IHDR.");
      }
      sawIhdr = true;
    }
    if (type === PNG_IEND_CHUNK_TYPE) {
      sawIend = true;
      chunks.push({ type, data });
      break;
    }
    chunks.push({ type, data });
  }

  if (!sawIend) {
    throw new Error("PNG parsing failed: missing IEND chunk.");
  }
  if (offset !== bytes.length) {
    throw new Error("PNG parsing failed: unexpected trailing bytes after IEND.");
  }
  return chunks;
}

function serializePngChunks(chunks: PngChunk[]): Uint8Array {
  if (chunks.length < 2 || chunks[0].type !== PNG_IHDR_CHUNK_TYPE || chunks[chunks.length - 1].type !== PNG_IEND_CHUNK_TYPE) {
    throw new Error("PNG serialization failed: invalid chunk sequence.");
  }

  const parts: Uint8Array[] = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    const typeBytes = asciiBytes(chunk.type);
    if (typeBytes.length !== 4) {
      throw new Error(`PNG serialization failed: invalid chunk type '${chunk.type}'.`);
    }
    const length = writeUint32Be(chunk.data.length >>> 0);
    const crc = writeUint32Be(crc32(concatBytes([typeBytes, chunk.data])));
    parts.push(length, typeBytes, chunk.data, crc);
  }
  return concatBytes(parts);
}

function buildITextChunk(keyword: string, text: string): PngChunk {
  const keywordBytes = latin1Bytes(keyword);
  const textBytes = new TextEncoder().encode(text);
  const data = concatBytes([
    keywordBytes,
    new Uint8Array([0]), // keyword separator
    new Uint8Array([0]), // compression flag (uncompressed)
    new Uint8Array([0]), // compression method
    new Uint8Array([0]), // language tag terminator (empty)
    new Uint8Array([0]), // translated keyword terminator (empty)
    textBytes
  ]);
  return { type: PNG_ITXT_CHUNK_TYPE, data };
}

function parseITextChunkText(data: Uint8Array, expectedKeyword: string): string | null {
  let offset = 0;
  while (offset < data.length && data[offset] !== 0) {
    offset += 1;
  }
  if (offset >= data.length) {
    throw new Error("PNG iTXt parsing failed: missing keyword terminator.");
  }
  const keyword = new TextDecoder("latin1").decode(data.slice(0, offset));
  offset += 1;
  if (offset + 2 > data.length) {
    throw new Error("PNG iTXt parsing failed: truncated compression header.");
  }
  const compressionFlag = data[offset];
  offset += 1;
  const compressionMethod = data[offset];
  offset += 1;

  while (offset < data.length && data[offset] !== 0) {
    offset += 1;
  }
  if (offset >= data.length) {
    throw new Error("PNG iTXt parsing failed: missing language tag terminator.");
  }
  offset += 1;

  while (offset < data.length && data[offset] !== 0) {
    offset += 1;
  }
  if (offset >= data.length) {
    throw new Error("PNG iTXt parsing failed: missing translated keyword terminator.");
  }
  offset += 1;

  if (keyword !== expectedKeyword) {
    return null;
  }
  if (compressionFlag !== 0) {
    throw new Error(
      `PNG iTXt parsing failed: compressed iTXt metadata is unsupported (method ${compressionMethod}).`
    );
  }

  return new TextDecoder().decode(data.slice(offset));
}

export function embedUtf8TextInPngMetadata(pngBytes: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = parsePngChunks(pngBytes);
  const filtered = chunks.filter(
    (chunk) => !(chunk.type === PNG_ITXT_CHUNK_TYPE && parseITextChunkText(chunk.data, keyword) !== null)
  );
  const iendIndex = filtered.findIndex((chunk) => chunk.type === PNG_IEND_CHUNK_TYPE);
  if (iendIndex <= 0) {
    throw new Error("PNG serialization failed: IEND chunk missing.");
  }
  filtered.splice(iendIndex, 0, buildITextChunk(keyword, text));
  return serializePngChunks(filtered);
}

export function extractUtf8TextFromPngMetadata(pngBytes: Uint8Array, keyword: string): string | null {
  const chunks = parsePngChunks(pngBytes);
  for (const chunk of chunks) {
    if (chunk.type !== PNG_ITXT_CHUNK_TYPE) {
      continue;
    }
    const value = parseITextChunkText(chunk.data, keyword);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export function embedSessionJsonInPng(pngBytes: Uint8Array, sessionJson: string): Uint8Array {
  return embedUtf8TextInPngMetadata(pngBytes, FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD, sessionJson);
}

export function extractSessionJsonFromPng(pngBytes: Uint8Array): string | null {
  return extractUtf8TextFromPngMetadata(pngBytes, FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD);
}

