import { describe, expect, test } from "vitest";
import { buildZipStore, parseZipStore } from "../src/utils/zipStore";

function readU16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

describe("zipStore", () => {
  test("builds a valid store-only zip with central directory", () => {
    const zip = buildZipStore([
      {
        name: "frames/frame_0000.png",
        data: new Uint8Array([1, 2, 3, 4])
      },
      {
        name: "frames/frame_0001.png",
        data: new Uint8Array([5, 6])
      }
    ]);

    expect(readU32(zip, 0)).toBe(0x04034b50);
    expect(readU32(zip, zip.length - 22)).toBe(0x06054b50);

    const entryCount = readU16(zip, zip.length - 22 + 10);
    expect(entryCount).toBe(2);

    const centralSize = readU32(zip, zip.length - 22 + 12);
    const centralOffset = readU32(zip, zip.length - 22 + 16);
    expect(centralOffset + centralSize + 22).toBe(zip.length);

    expect(readU32(zip, centralOffset)).toBe(0x02014b50);
  });

  test("rejects unsafe names", () => {
    expect(() =>
      buildZipStore([
        {
          name: "../bad.txt",
          data: new Uint8Array([1])
        }
      ])
    ).toThrow();
  });

  test("parses zip entries built by buildZipStore", () => {
    const sourceEntries = [
      {
        name: "sessions/foo/bar.png",
        data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
        modifiedAt: new Date(2025, 1, 2, 3, 4, 6)
      },
      {
        name: "sessions/baz.png",
        data: new Uint8Array([9, 8, 7, 6, 5]),
        modifiedAt: new Date(2025, 5, 7, 8, 9, 10)
      }
    ] as const;

    const zip = buildZipStore(sourceEntries.map((entry) => ({ ...entry })));
    const parsed = parseZipStore(zip);

    expect(parsed.map((entry) => entry.name)).toEqual(sourceEntries.map((entry) => entry.name));
    expect(parsed.map((entry) => [...entry.data])).toEqual(sourceEntries.map((entry) => [...entry.data]));
    expect(parsed.every((entry) => entry.modifiedAt instanceof Date || entry.modifiedAt === null)).toBe(true);
  });
});
