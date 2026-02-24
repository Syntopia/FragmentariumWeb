import { describe, expect, test } from "vitest";

import {
  listGitHubGalleryPngEntries,
  parseGitHubGalleryTreeUrl,
  type GitHubFetchLike
} from "../src/utils/githubGallerySources";

describe("githubGallerySources", () => {
  test("parses a github tree folder URL", () => {
    const parsed = parseGitHubGalleryTreeUrl(
      "https://github.com/Syntopia/FragmentariumWeb/tree/main/factory%20sessions/sessions"
    );

    expect(parsed.owner).toBe("Syntopia");
    expect(parsed.repo).toBe("FragmentariumWeb");
    expect(parsed.branch).toBe("main");
    expect(parsed.path).toBe("factory sessions/sessions");
    expect(parsed.sourceTreePath).toBe("GitHub/Syntopia/FragmentariumWeb/main/factory sessions/sessions");
    expect(parsed.id).toBe("github:Syntopia/FragmentariumWeb@main:factory sessions/sessions");
  });

  test("rejects non-tree github URLs", () => {
    expect(() => parseGitHubGalleryTreeUrl("https://github.com/Syntopia/FragmentariumWeb")).toThrow("/tree/");
  });

  test("lists PNG files recursively from GitHub contents API", async () => {
    const source = parseGitHubGalleryTreeUrl("https://github.com/owner/repo/tree/main/previews");
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
});
