import { parseSessionGalleryZipV2 } from "./sessionGalleryZip";
import { parseZipStore } from "./zipStore";

export interface GitHubGalleryTreeSource {
  kind: "tree";
  id: string;
  url: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  sourcePathSegments: string[];
  sourceTreePath: string;
  sourceLabel: string;
}

export interface GitHubGalleryZipSource {
  kind: "zip";
  id: string;
  url: string;
  sourceTreePath: string;
  sourceLabel: string;
}

export type GitHubGallerySource = GitHubGalleryTreeSource | GitHubGalleryZipSource;

export interface GitHubGalleryPngEntry {
  relativePath: string;
  repoPath: string;
  downloadUrl: string;
  fileName: string;
}

export interface GitHubGalleryZipSessionEntry {
  relativePath: string;
  sessionJson: string;
  previewImageBytes: Uint8Array;
  previewImageMimeType: string;
  updatedAtMs: number;
}

interface GitHubContentsDirEntry {
  type: string;
  name?: unknown;
  path?: unknown;
  download_url?: unknown;
}

interface GitHubFetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export type GitHubFetchLike = (input: string, init?: RequestInit) => Promise<GitHubFetchLikeResponse>;

const GITHUB_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com"
]);

function encodeRepoPath(path: string): string {
  if (path.length === 0) {
    return "";
  }
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildContentsApiUrl(source: GitHubGalleryTreeSource, repoPath: string): string {
  const encodedPath = encodeRepoPath(repoPath);
  const pathPart = encodedPath.length > 0 ? `/${encodedPath}` : "";
  return `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents${pathPart}?ref=${encodeURIComponent(source.branch)}`;
}

function ensureDirectoryEntries(value: unknown, sourceLabel: string, repoPath: string): GitHubContentsDirEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub source '${sourceLabel}' did not return a folder listing for '${repoPath || "/"}'.`);
  }
  return value as GitHubContentsDirEntry[];
}

function ensureString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub API response missing '${field}' for ${context}.`);
  }
  return value;
}

function stripSourcePathPrefix(repoPath: string, sourcePath: string): string {
  if (sourcePath.length === 0) {
    return repoPath;
  }
  if (repoPath === sourcePath) {
    return "";
  }
  const prefix = `${sourcePath}/`;
  if (!repoPath.startsWith(prefix)) {
    throw new Error(`GitHub PNG path '${repoPath}' is outside source folder '${sourcePath}'.`);
  }
  return repoPath.slice(prefix.length);
}

async function fetchGitHubJsonOrThrow(fetchImpl: GitHubFetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}) for '${url}'.`);
  }
  if (typeof response.json !== "function") {
    throw new Error(`GitHub API response did not expose JSON for '${url}'.`);
  }
  return await response.json();
}

async function fetchArrayBufferOrThrow(fetchImpl: GitHubFetchLike, url: string): Promise<ArrayBuffer> {
  const response = await fetchImpl(url, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(`GitHub ZIP request failed (${response.status} ${response.statusText}) for '${url}'.`);
  }
  if (typeof response.arrayBuffer !== "function") {
    throw new Error(`GitHub ZIP response did not expose binary payload for '${url}'.`);
  }
  return await response.arrayBuffer();
}

function parseZipSource(inputUrl: string, parsedUrl: URL): GitHubGalleryZipSource {
  const rawLabel = decodeURIComponent(parsedUrl.pathname.split("/").filter((segment) => segment.length > 0).at(-1) ?? "gallery.zip");
  const sourceLabel = `zip:${parsedUrl.hostname}/${rawLabel}`;
  const sourceTreePath = `GitHub/${sourceLabel}`;
  return {
    kind: "zip",
    id: `github-zip:${parsedUrl.toString()}`,
    url: inputUrl,
    sourceTreePath,
    sourceLabel
  };
}

export function parseGitHubGalleryTreeUrl(inputUrl: string): GitHubGallerySource {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(inputUrl);
  } catch (error) {
    throw new Error(`Invalid URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!(parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:")) {
    throw new Error("GitHub gallery source URL must use http or https.");
  }
  if (!GITHUB_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error("GitHub gallery source URL must be a GitHub tree URL or a GitHub-hosted ZIP URL.");
  }

  if (parsedUrl.pathname.toLowerCase().endsWith(".zip")) {
    return parseZipSource(inputUrl, parsedUrl);
  }

  const rawSegments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);
  const segments = rawSegments.map((segment) => decodeURIComponent(segment));
  if (segments.length < 4) {
    throw new Error("GitHub gallery source URL must look like /owner/repo/tree/branch[/path] or end with .zip.");
  }

  const [owner, repo, treeLiteral, branch, ...pathSegments] = segments;
  if (treeLiteral !== "tree") {
    throw new Error("GitHub gallery source URL must point to a folder tree (contains '/tree/').");
  }
  if (owner.length === 0 || repo.length === 0 || branch.length === 0) {
    throw new Error("GitHub gallery source URL is missing owner, repo, or branch.");
  }

  const normalizedPath = pathSegments.join("/").replace(/\/+/g, "/");
  const sourceTreePath = `GitHub/${owner}/${repo}/${branch}${normalizedPath.length > 0 ? `/${normalizedPath}` : ""}`;

  return {
    kind: "tree",
    id: `github:${owner}/${repo}@${branch}:${normalizedPath}`,
    url: inputUrl,
    owner,
    repo,
    branch,
    path: normalizedPath,
    sourcePathSegments: pathSegments,
    sourceTreePath,
    sourceLabel: `${owner}/${repo}@${branch}${normalizedPath.length > 0 ? `:${normalizedPath}` : ""}`
  };
}

export async function listGitHubGalleryPngEntries(
  source: GitHubGalleryTreeSource,
  fetchImpl: GitHubFetchLike = fetch as unknown as GitHubFetchLike
): Promise<GitHubGalleryPngEntry[]> {
  const results: GitHubGalleryPngEntry[] = [];

  const walkDirectory = async (repoPath: string): Promise<void> => {
    const contentsUrl = buildContentsApiUrl(source, repoPath);
    const payload = await fetchGitHubJsonOrThrow(fetchImpl, contentsUrl);
    const entries = ensureDirectoryEntries(payload, source.sourceLabel, repoPath);
    for (const entry of entries) {
      const entryType = ensureString(entry.type, "type", `GitHub contents entry at '${repoPath || "/"}'`);
      const entryPath = ensureString(entry.path, "path", `GitHub contents entry at '${repoPath || "/"}'`);
      if (entryType === "dir") {
        await walkDirectory(entryPath);
        continue;
      }
      if (entryType !== "file" || !entryPath.toLowerCase().endsWith(".png")) {
        continue;
      }
      const downloadUrl = ensureString(entry.download_url, "download_url", `PNG '${entryPath}'`);
      const relativePath = stripSourcePathPrefix(entryPath, source.path);
      if (relativePath.length === 0) {
        continue;
      }
      results.push({
        relativePath,
        repoPath: entryPath,
        downloadUrl,
        fileName: ensureString(entry.name, "name", `PNG '${entryPath}'`)
      });
    }
  };

  await walkDirectory(source.path);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

export async function listGitHubGalleryZipSessionEntries(
  source: GitHubGalleryZipSource,
  fetchImpl: GitHubFetchLike = fetch as unknown as GitHubFetchLike
): Promise<GitHubGalleryZipSessionEntry[]> {
  const zipBytes = new Uint8Array(await fetchArrayBufferOrThrow(fetchImpl, source.url));
  const zipEntries = parseZipStore(zipBytes).filter((entry) => !entry.name.endsWith("/"));
  const parsed = parseSessionGalleryZipV2(zipEntries);
  if (parsed === null) {
    throw new Error(`ZIP source '${source.sourceLabel}' is missing a v2 session gallery manifest.`);
  }
  return parsed
    .map((entry) => ({
      relativePath: entry.path,
      sessionJson: entry.sessionJson,
      previewImageBytes: entry.previewImageBytes,
      previewImageMimeType: entry.previewImageMimeType,
      updatedAtMs: entry.updatedAtMs
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
