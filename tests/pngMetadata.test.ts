import { describe, expect, test } from "vitest";
import {
  embedSessionJsonInPng,
  extractSessionJsonFromPng,
  FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD,
  embedUtf8TextInPngMetadata,
  extractUtf8TextFromPngMetadata
} from "../src/utils/pngMetadata";

function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// 1x1 transparent PNG
const TINY_PNG_BYTES = decodeBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
);

describe("pngMetadata", () => {
  test("embeds and extracts session JSON in a PNG iTXt chunk", () => {
    const sessionJson = JSON.stringify({
      format: "fragmentarium-web-settings-v1",
      selectedPresetName: null,
      integratorId: "de-raytracer"
    });

    const embedded = embedSessionJsonInPng(TINY_PNG_BYTES, sessionJson);
    const extracted = extractSessionJsonFromPng(embedded);

    expect(extracted).toBe(sessionJson);
    expect(extractSessionJsonFromPng(TINY_PNG_BYTES)).toBeNull();
  });

  test("replaces existing session metadata for the same keyword", () => {
    const first = embedUtf8TextInPngMetadata(TINY_PNG_BYTES, FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD, "{\"a\":1}");
    const second = embedUtf8TextInPngMetadata(first, FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD, "{\"a\":2}");

    expect(extractUtf8TextFromPngMetadata(second, FRAGMENTARIUM_WEB_SESSION_PNG_KEYWORD)).toBe("{\"a\":2}");
  });

  test("throws on invalid PNG data", () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => extractSessionJsonFromPng(notPng)).toThrow(/Invalid PNG signature/);
  });
});
