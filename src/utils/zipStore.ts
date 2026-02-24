export interface ZipStoreEntry {
  name: string;
  data: Uint8Array;
  modifiedAt?: Date;
}

export interface ParsedZipStoreEntry {
  name: string;
  data: Uint8Array;
  modifiedAt: Date | null;
}

interface InternalZipEntry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeName(name: string): Uint8Array {
  if (name.length === 0) {
    throw new Error("ZIP entry name cannot be empty.");
  }
  if (name.includes("\\")) {
    throw new Error(`ZIP entry name must use '/': ${name}`);
  }
  if (name.startsWith("/") || name.includes("../")) {
    throw new Error(`ZIP entry name must be relative and safe: ${name}`);
  }
  return new TextEncoder().encode(name);
}

function toDosDateTime(dateRaw: Date | undefined): { dosDate: number; dosTime: number } {
  const date = dateRaw ?? new Date();
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = Math.min(12, Math.max(1, date.getMonth() + 1));
  const day = Math.min(31, Math.max(1, date.getDate()));
  const hours = Math.min(23, Math.max(0, date.getHours()));
  const minutes = Math.min(59, Math.max(0, date.getMinutes()));
  const seconds = Math.min(59, Math.max(0, date.getSeconds()));

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | Math.floor(seconds / 2);
  return { dosDate, dosTime };
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function readU16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) {
    throw new Error("ZIP parse failed: unexpected end of data.");
  }
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) {
    throw new Error("ZIP parse failed: unexpected end of data.");
  }
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function decodeName(nameBytes: Uint8Array, utf8: boolean): string {
  if (utf8) {
    return new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
  }
  return new TextDecoder("latin1").decode(nameBytes);
}

function fromDosDateTime(dosDate: number, dosTime: number): Date | null {
  const year = 1980 + ((dosDate >> 9) & 0x7f);
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >> 11) & 0x1f;
  const minute = (dosTime >> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function parseZipStore(data: Uint8Array): ParsedZipStoreEntry[] {
  if (data.length < 22) {
    throw new Error("ZIP parse failed: data too short.");
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= minOffset; i -= 1) {
    if (readU32(data, i) === 0x06054b50) {
      const commentLength = readU16(data, i + 20);
      if (i + 22 + commentLength === data.length) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset < 0) {
    throw new Error("ZIP parse failed: EOCD record not found.");
  }

  const diskNo = readU16(data, eocdOffset + 4);
  const startDiskNo = readU16(data, eocdOffset + 6);
  const entryCountThisDisk = readU16(data, eocdOffset + 8);
  const entryCount = readU16(data, eocdOffset + 10);
  const centralSize = readU32(data, eocdOffset + 12);
  const centralOffset = readU32(data, eocdOffset + 16);
  if (diskNo !== 0 || startDiskNo !== 0 || entryCountThisDisk !== entryCount) {
    throw new Error("ZIP parse failed: multi-disk ZIPs are unsupported.");
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error("ZIP parse failed: central directory range is invalid.");
  }

  const entries: ParsedZipStoreEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(data, offset) !== 0x02014b50) {
      throw new Error("ZIP parse failed: invalid central directory header signature.");
    }
    const flags = readU16(data, offset + 8);
    const method = readU16(data, offset + 10);
    const dosTime = readU16(data, offset + 12);
    const dosDate = readU16(data, offset + 14);
    const compressedSize = readU32(data, offset + 20);
    const uncompressedSize = readU32(data, offset + 24);
    const nameLen = readU16(data, offset + 28);
    const extraLen = readU16(data, offset + 30);
    const commentLen = readU16(data, offset + 32);
    const localHeaderOffset = readU32(data, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + commentLen > data.length) {
      throw new Error("ZIP parse failed: central directory entry extends past file end.");
    }
    if ((flags & (1 << 3)) !== 0) {
      throw new Error("ZIP parse failed: data descriptor ZIP entries are unsupported.");
    }
    if (method !== 0) {
      throw new Error(`ZIP parse failed: compression method ${method} is unsupported (store-only ZIP required).`);
    }

    const utf8 = (flags & (1 << 11)) !== 0;
    const nameBytes = data.slice(nameStart, nameEnd);
    const name = decodeName(nameBytes, utf8);
    if (name.length === 0) {
      throw new Error("ZIP parse failed: empty entry name.");
    }

    if (readU32(data, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`ZIP parse failed: invalid local header signature for '${name}'.`);
    }
    const localFlags = readU16(data, localHeaderOffset + 6);
    const localMethod = readU16(data, localHeaderOffset + 8);
    const localNameLen = readU16(data, localHeaderOffset + 26);
    const localExtraLen = readU16(data, localHeaderOffset + 28);
    if (localMethod !== method || localFlags !== flags) {
      throw new Error(`ZIP parse failed: local header mismatch for '${name}'.`);
    }
    const localDataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const localDataEnd = localDataStart + compressedSize;
    if (localDataEnd > data.length) {
      throw new Error(`ZIP parse failed: truncated local data for '${name}'.`);
    }

    const entryData = data.slice(localDataStart, localDataEnd);
    if (compressedSize !== uncompressedSize) {
      throw new Error(`ZIP parse failed: compressed size mismatch for store-only entry '${name}'.`);
    }

    entries.push({
      name,
      data: entryData,
      modifiedAt: fromDosDateTime(dosDate, dosTime)
    });

    offset = nameEnd + extraLen + commentLen;
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error("ZIP parse failed: central directory size mismatch.");
  }

  return entries;
}

export function buildZipStore(entries: ZipStoreEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error("ZIP export requires at least one entry.");
  }

  const internalEntries: InternalZipEntry[] = entries.map((entry) => {
    const nameBytes = encodeName(entry.name);
    const { dosDate, dosTime } = toDosDateTime(entry.modifiedAt);
    if (nameBytes.length > 0xffff) {
      throw new Error(`ZIP entry name too long: ${entry.name}`);
    }
    if (entry.data.length > 0xffffffff) {
      throw new Error(`ZIP entry too large for ZIP32: ${entry.name}`);
    }
    return {
      nameBytes,
      data: entry.data,
      crc32: crc32(entry.data),
      compressedSize: entry.data.length,
      uncompressedSize: entry.data.length,
      dosDate,
      dosTime,
      localHeaderOffset: 0
    };
  });

  const localChunks: Uint8Array[] = [];
  let offset = 0;
  for (const entry of internalEntries) {
    entry.localHeaderOffset = offset;
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, 20); // version needed
    writeU16(view, 6, 1 << 11); // UTF-8 names
    writeU16(view, 8, 0); // method: store
    writeU16(view, 10, entry.dosTime);
    writeU16(view, 12, entry.dosDate);
    writeU32(view, 14, entry.crc32);
    writeU32(view, 18, entry.compressedSize);
    writeU32(view, 22, entry.uncompressedSize);
    writeU16(view, 26, entry.nameBytes.length);
    writeU16(view, 28, 0); // extra len
    localHeader.set(entry.nameBytes, 30);
    localChunks.push(localHeader, entry.data);
    offset += localHeader.length + entry.data.length;
  }

  const centralChunks: Uint8Array[] = [];
  const centralDirOffset = offset;
  for (const entry of internalEntries) {
    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(centralHeader.buffer, centralHeader.byteOffset, centralHeader.byteLength);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 20); // version made by
    writeU16(view, 6, 20); // version needed
    writeU16(view, 8, 1 << 11); // UTF-8
    writeU16(view, 10, 0); // store
    writeU16(view, 12, entry.dosTime);
    writeU16(view, 14, entry.dosDate);
    writeU32(view, 16, entry.crc32);
    writeU32(view, 20, entry.compressedSize);
    writeU32(view, 24, entry.uncompressedSize);
    writeU16(view, 28, entry.nameBytes.length);
    writeU16(view, 30, 0); // extra len
    writeU16(view, 32, 0); // comment len
    writeU16(view, 34, 0); // disk number
    writeU16(view, 36, 0); // internal attrs
    writeU32(view, 38, 0); // external attrs
    writeU32(view, 42, entry.localHeaderOffset);
    centralHeader.set(entry.nameBytes, 46);
    centralChunks.push(centralHeader);
    offset += centralHeader.length;
  }
  const centralDirSize = offset - centralDirOffset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
  writeU32(eocdView, 0, 0x06054b50);
  writeU16(eocdView, 4, 0);
  writeU16(eocdView, 6, 0);
  writeU16(eocdView, 8, internalEntries.length);
  writeU16(eocdView, 10, internalEntries.length);
  writeU32(eocdView, 12, centralDirSize);
  writeU32(eocdView, 16, centralDirOffset);
  writeU16(eocdView, 20, 0);

  return concatUint8([...localChunks, ...centralChunks, eocd]);
}

export function buildZipStoreBlob(entries: ZipStoreEntry[]): Blob {
  const zip = buildZipStore(entries);
  const copy = new Uint8Array(zip.byteLength);
  copy.set(zip);
  return new Blob([copy.buffer as ArrayBuffer], { type: "application/zip" });
}
