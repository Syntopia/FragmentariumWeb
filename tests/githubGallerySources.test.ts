import { describe, expect, test } from "vitest";

import {
  listGitHubGalleryZipSessionEntries,
  listGitHubGalleryPngEntries,
  parseGitHubGalleryTreeUrl,
  type GitHubFetchLike
} from "../src/utils/githubGallerySources";
import { buildSessionGalleryZipV2Entries } from "../src/utils/sessionGalleryZip";
import { buildZipStore } from "../src/utils/zipStore";

describe("githubGallerySources", () => {
  test("parses a github tree folder URL", () => {
    const parsed = parseGitHubGalleryTreeUrl(
      "https://github.com/Syntopia/FragmentariumWeb/tree/main/factory%20sessions/sessions"
    );

    expect(parsed.kind).toBe("tree");
    if (parsed.kind !== "tree") {
      throw new Error("Expected tree source.");
    }
    expect(parsed.owner).toBe("Syntopia");
    expect(parsed.repo).toBe("FragmentariumWeb");
    expect(parsed.branch).toBe("main");
    expect(parsed.path).toBe("factory sessions/sessions");
    expect(parsed.sourceTreePath).toBe("GitHub/Syntopia/FragmentariumWeb/main/factory sessions/sessions");
    expect(parsed.id).toBe("github:Syntopia/FragmentariumWeb@main:factory sessions/sessions");
  });

  test("parses a github zip source URL", () => {
    const parsed = parseGitHubGalleryTreeUrl(
      "https://raw.githubusercontent.com/Syntopia/FragmentariumWeb/main/gallery/session-gallery.zip"
    );
    expect(parsed.kind).toBe("zip");
    if (parsed.kind !== "zip") {
      throw new Error("Expected zip source.");
    }
    expect(parsed.id).toContain("github-zip:");
    expect(parsed.sourceTreePath).toContain("GitHub/zip:");
    expect(parsed.sourceLabel).toContain("session-gallery.zip");
  });

  test("rejects non-tree github URLs", () => {
    expect(() => parseGitHubGalleryTreeUrl("https://github.com/Syntopia/FragmentariumWeb")).toThrow("/tree/");
  });

  test("lists PNG files recursively from GitHub contents API", async () => {
    const parsedSource = parseGitHubGalleryTreeUrl("https://github.com/owner/repo/tree/main/previews");
    if (parsedSource.kind !== "tree") {
      throw new Error("Expected tree source.");
    }
    const source = parsedSource;
    const responses = new Map<string, unknown>([
      [
        "https://api.github.com/repos/owner/repo/contents/previews?ref=main",
        [
          {
            type: "file",
            name: "a.png",
            path: "previews/a.png",
            download_url: "https://raw.example/a.png"
          },
          {
            type: "file",
            name: "readme.txt",
            path: "previews/readme.txt",
            download_url: "https://raw.example/readme.txt"
          },
          {
            type: "dir",
            name: "nested",
            path: "previews/nested"
          }
        ]
      ],
      [
        "https://api.github.com/repos/owner/repo/contents/previews/nested?ref=main",
        [
          {
            type: "file",
            name: "b.PNG",
            path: "previews/nested/b.PNG",
            download_url: "https://raw.example/b.PNG"
          }
        ]
      ]
    ]);

    const fetchMock: GitHubFetchLike = async (input) => {
      const payload = responses.get(String(input));
      if (payload === undefined) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({})
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => payload
      };
    };

    const entries = await listGitHubGalleryPngEntries(source, fetchMock);
    expect(entries).toEqual([
      {
        relativePath: "a.png",
        repoPath: "previews/a.png",
        downloadUrl: "https://raw.example/a.png",
        fileName: "a.png"
      },
      {
        relativePath: "nested/b.PNG",
        repoPath: "previews/nested/b.PNG",
        downloadUrl: "https://raw.example/b.PNG",
        fileName: "b.PNG"
      }
    ]);
  });

  test("lists sessions from a GitHub ZIP v2 source", async () => {
    const parsedSource = parseGitHubGalleryTreeUrl(
      "https://raw.githubusercontent.com/owner/repo/main/session-gallery.zip"
    );
    if (parsedSource.kind !== "zip") {
      throw new Error("Expected zip source.");
    }

    const zipEntries = buildSessionGalleryZipV2Entries([
      {
        path: "folder/session-a",
        sessionJson: JSON.stringify({ name: "a" }),
        previewImageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        previewImageMimeType: "image/jpeg",
        createdAtMs: 1000,
        updatedAtMs: 2000
      }
    ]);
    const zipBytes = buildZipStore(zipEntries);

    const fetchMock: GitHubFetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => {
        const buffer = new ArrayBuffer(zipBytes.byteLength);
        new Uint8Array(buffer).set(zipBytes);
        return buffer;
      }
    });

    const entries = await listGitHubGalleryZipSessionEntries(parsedSource, fetchMock);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.relativePath).toBe("folder/session-a");
    expect(entries[0]?.previewImageMimeType).toBe("image/jpeg");
    expect(entries[0]?.sessionJson).toContain("\"a\"");
  });
});
