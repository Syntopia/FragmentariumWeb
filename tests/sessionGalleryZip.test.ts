import { describe, expect, test } from "vitest";

import {
  buildSessionGalleryZipV2Entries,
  parseSessionGalleryZipV2
} from "../src/utils/sessionGalleryZip";
import { buildZipStore, parseZipStore } from "../src/utils/zipStore";

describe("sessionGalleryZip v2", () => {
  test("round-trips sessions through v2 manifest format", () => {
    const entries = buildSessionGalleryZipV2Entries(
      [
        {
          path: "folder/a",
          sessionJson: JSON.stringify({ id: "a" }),
          previewImageBytes: new Uint8Array([1, 2, 3]),
          previewImageMimeType: "image/jpeg",
          createdAtMs: 1000,
          updatedAtMs: 2000
        },
        {
          path: "folder/b",
          sessionJson: JSON.stringify({ id: "b" }),
          previewImageBytes: new Uint8Array([4, 5, 6, 7]),
          previewImageMimeType: "image/png",
          createdAtMs: 3000,
          updatedAtMs: 4000
        }
      ],
      5000
    );
    const zipBytes = buildZipStore(entries);
    const parsedEntries = parseZipStore(zipBytes);
    const parsed = parseSessionGalleryZipV2(parsedEntries);

    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]?.path).toBe("folder/a");
    expect(parsed?.[0]?.previewImageMimeType).toBe("image/jpeg");
    expect(parsed?.[1]?.path).toBe("folder/b");
    expect(parsed?.[1]?.previewImageMimeType).toBe("image/png");
  });

  test("returns null when ZIP is not v2 format", () => {
    const zipBytes = buildZipStore([
      {
        name: "sessions/a.png",
        data: new Uint8Array([1, 2, 3])
      }
    ]);
    const parsedEntries = parseZipStore(zipBytes);
    expect(parseSessionGalleryZipV2(parsedEntries)).toBeNull();
  });

  test("round-trips optional preview frame sequences", () => {
    const entries = buildSessionGalleryZipV2Entries(
      [
        {
          path: "folder/animated",
          sessionJson: JSON.stringify({ id: "animated" }),
          previewImageBytes: new Uint8Array([1, 2, 3, 4]),
          previewImageMimeType: "image/jpeg",
          previewFrames: [
            {
              imageBytes: new Uint8Array([10, 11]),
              imageMimeType: "image/jpeg",
              keyframeId: "k0",
              t: 0
            },
            {
              imageBytes: new Uint8Array([12, 13]),
              imageMimeType: "image/jpeg",
              keyframeId: "k1",
              t: 1
            }
          ],
          createdAtMs: 1000,
          updatedAtMs: 2000
        }
      ],
      3000
    );
    const zipBytes = buildZipStore(entries);
    const parsedEntries = parseZipStore(zipBytes);
    const parsed = parseSessionGalleryZipV2(parsedEntries);

    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.previewFrames).not.toBeNull();
    expect(parsed?.[0]?.previewFrames).toHaveLength(2);
    expect(parsed?.[0]?.previewFrames?.[0]?.keyframeId).toBe("k0");
    expect(parsed?.[0]?.previewFrames?.[1]?.t).toBe(1);
  });
});
