const STORAGE_KEY = "fragmentarium-web-github-gallery-sources-v1";

export function loadGitHubGallerySourceUrls(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid GitHub gallery source store payload.");
  }
  const urls = parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return [...new Set(urls)];
}

export function saveGitHubGallerySourceUrls(urls: string[]): void {
  const normalized = [...new Set(urls.map((url) => url.trim()).filter((url) => url.length > 0))];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}
