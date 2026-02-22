import { describe, expect, test } from "vitest";
import { buildWebmFile } from "../src/utils/webmMuxer";

function bytesToAscii(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("webmMuxer", () => {
  test("builds a WebM container with EBML header and VP9 codec id", () => {
    const webm = buildWebmFile({
      width: 640,
      height: 360,
      fps: 30,
      codecId: "V_VP9",
      chunks: [
        {
          timestampUs: 0,
          durationUs: 33_333,
          keyFrame: true,
          data: new Uint8Array([1, 2, 3, 4, 5])
        },
        {
          timestampUs: 33_333,
          durationUs: 33_333,
          keyFrame: false,
          data: new Uint8Array([9, 8, 7])
        }
      ]
    });

    expect(webm[0]).toBe(0x1a);
    expect(webm[1]).toBe(0x45);
    expect(webm[2]).toBe(0xdf);
    expect(webm[3]).toBe(0xa3);

    const ascii = bytesToAscii(webm);
    expect(ascii).toContain("webm");
    expect(ascii).toContain("V_VP9");
  });

  test("rejects empty chunk lists", () => {
    expect(() =>
      buildWebmFile({
        width: 320,
        height: 240,
        fps: 24,
        codecId: "V_VP8",
        chunks: []
      })
    ).toThrowError("Cannot build WebM without encoded chunks.");
  });
});

