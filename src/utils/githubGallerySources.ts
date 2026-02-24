export interface GitHubGalleryTreeSource {
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

export interface GitHubGalleryPngEntry {
  relativePath: string;
  repoPath: string;
  downloadUrl: string;
  fileName: string;
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
  json(): Promise<unknown>;
}

export type GitHubFetchLike = (input: string, init?: RequestInit) => Promise<GitHubFetchLikeResponse>;

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

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
  return await response.json();
}

export function parseGitHubGalleryTreeUrl(inputUrl: string): GitHubGalleryTreeSource {
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
    throw new Error("GitHub gallery source URL must be a github.com repository tree URL.");
  }

  const rawSegments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);
  const segments = rawSegments.map((segment) => decodeURIComponent(segment));
  if (segments.length < 4) {
    throw new Error("GitHub gallery source URL must look like /owner/repo/tree/branch[/path].");
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
