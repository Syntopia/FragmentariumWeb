export interface ZipStoreEntry {
  name: string;
  data: Uint8Array;
  modifiedAt?: Date;
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
