import type { ParsedZipStoreEntry, ZipStoreEntry } from "./zipStore";

export const SESSION_GALLERY_V2_MANIFEST_ENTRY_NAME = "fragmentarium-web-session-gallery-manifest-v2.json";
const SESSION_GALLERY_V2_FORMAT_ID = "fragmentarium-web-session-gallery-v2";

interface SessionGalleryManifestV2 {
  format: string;
  version: number;
  generatedAtMs: number;
  sessions: SessionGalleryManifestSessionV2[];
}

interface SessionGalleryManifestSessionV2 {
  path: string;
  sessionJsonEntryName: string;
  previewImageEntryName: string;
  previewImageMimeType: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SessionGalleryZipV2BuildSession {
  path: string;
  sessionJson: string;
  previewImageBytes: Uint8Array;
  previewImageMimeType: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SessionGalleryZipV2ParsedSession {
  path: string;
  sessionJson: string;
  previewImageBytes: Uint8Array;
  previewImageMimeType: string;
  createdAtMs: number;
  updatedAtMs: number;
}

function normalizeSessionPath(path: string): string {
  const normalized = path
    .trim()
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (normalized.length === 0) {
    throw new Error("Session path cannot be empty.");
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new Error(`Invalid session path '${path}'.`);
    }
  }
  return normalized;
}

function extensionForPreviewMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  throw new Error(`Unsupported preview image MIME type '${mimeType}'.`);
}

function inferMimeTypeFromPreviewEntryName(entryName: string): string | null {
  const lower = entryName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return null;
}

export function buildSessionGalleryZipV2Entries(
  sessions: SessionGalleryZipV2BuildSession[],
  generatedAtMs: number = Date.now()
): ZipStoreEntry[] {
  if (sessions.length === 0) {
    throw new Error("Session gallery ZIP export requires at least one session.");
  }
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error("Session gallery ZIP generatedAtMs must be finite.");
  }

  const entries: ZipStoreEntry[] = [];
  const manifestSessions: SessionGalleryManifestSessionV2[] = [];
  const seenPaths = new Set<string>();

  for (const session of sessions) {
    const normalizedPath = normalizeSessionPath(session.path);
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Duplicate session path in ZIP export: '${normalizedPath}'.`);
    }
    seenPaths.add(normalizedPath);
    if (session.sessionJson.trim().length === 0) {
      throw new Error(`Session '${normalizedPath}' has empty session JSON.`);
    }
    if (!Number.isFinite(session.createdAtMs) || !Number.isFinite(session.updatedAtMs)) {
      throw new Error(`Session '${normalizedPath}' has invalid timestamps.`);
    }
    const previewImageMimeType = session.previewImageMimeType.trim();
    if (previewImageMimeType.length === 0) {
      throw new Error(`Session '${normalizedPath}' has empty preview image MIME type.`);
    }
    const previewExt = extensionForPreviewMimeType(previewImageMimeType);
    const sessionBase = `sessions/${normalizedPath}`;
    const sessionJsonEntryName = `${sessionBase}/session.json`;
    const previewImageEntryName = `${sessionBase}/preview.${previewExt}`;

    entries.push({
      name: sessionJsonEntryName,
      data: new TextEncoder().encode(session.sessionJson),
      modifiedAt: new Date(session.updatedAtMs)
    });
    entries.push({
      name: previewImageEntryName,
      data: session.previewImageBytes,
      modifiedAt: new Date(session.updatedAtMs)
    });
    manifestSessions.push({
      path: normalizedPath,
      sessionJsonEntryName,
      previewImageEntryName,
      previewImageMimeType,
      createdAtMs: session.createdAtMs,
      updatedAtMs: session.updatedAtMs
    });
  }

  manifestSessions.sort((a, b) => a.path.localeCompare(b.path));
  const manifest: SessionGalleryManifestV2 = {
    format: SESSION_GALLERY_V2_FORMAT_ID,
    version: 2,
    generatedAtMs,
    sessions: manifestSessions
  };
  entries.push({
    name: SESSION_GALLERY_V2_MANIFEST_ENTRY_NAME,
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    modifiedAt: new Date(generatedAtMs)
  });

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function parseManifestSession(value: unknown): SessionGalleryManifestSessionV2 {
  if (typeof value !== "object" || value === null) {
    throw new Error("Session gallery ZIP manifest has an invalid session entry.");
  }
  const source = value as Record<string, unknown>;
  const path = source.path;
  const sessionJsonEntryName = source.sessionJsonEntryName;
  const previewImageEntryName = source.previewImageEntryName;
  const previewImageMimeType = source.previewImageMimeType;
  const createdAtMs = source.createdAtMs;
  const updatedAtMs = source.updatedAtMs;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("Session gallery ZIP manifest session entry is missing 'path'.");
  }
  if (typeof sessionJsonEntryName !== "string" || sessionJsonEntryName.trim().length === 0) {
    throw new Error(`Session '${path}' is missing 'sessionJsonEntryName' in ZIP manifest.`);
  }
  if (typeof previewImageEntryName !== "string" || previewImageEntryName.trim().length === 0) {
    throw new Error(`Session '${path}' is missing 'previewImageEntryName' in ZIP manifest.`);
  }
  if (typeof previewImageMimeType !== "string" || previewImageMimeType.trim().length === 0) {
    throw new Error(`Session '${path}' is missing 'previewImageMimeType' in ZIP manifest.`);
  }
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs)) {
    throw new Error(`Session '${path}' has invalid 'createdAtMs' in ZIP manifest.`);
  }
  if (typeof updatedAtMs !== "number" || !Number.isFinite(updatedAtMs)) {
    throw new Error(`Session '${path}' has invalid 'updatedAtMs' in ZIP manifest.`);
  }
  return {
    path: normalizeSessionPath(path),
    sessionJsonEntryName,
    previewImageEntryName,
    previewImageMimeType,
    createdAtMs,
    updatedAtMs
  };
}

export function parseSessionGalleryZipV2(entries: ParsedZipStoreEntry[]): SessionGalleryZipV2ParsedSession[] | null {
  const manifestEntry = entries.find((entry) => entry.name === SESSION_GALLERY_V2_MANIFEST_ENTRY_NAME) ?? null;
  if (manifestEntry === null) {
    return null;
  }

  let manifest: SessionGalleryManifestV2;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as SessionGalleryManifestV2;
  } catch (error) {
    throw new Error(
      `Session gallery ZIP v2 manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (manifest.format !== SESSION_GALLERY_V2_FORMAT_ID) {
    throw new Error(`Unsupported session gallery ZIP format '${manifest.format}'.`);
  }
  if (manifest.version !== 2) {
    throw new Error(`Unsupported session gallery ZIP version '${manifest.version}'.`);
  }
  if (!Array.isArray(manifest.sessions) || manifest.sessions.length === 0) {
    throw new Error("Session gallery ZIP v2 manifest has no sessions.");
  }

  const entryByName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const parsed: SessionGalleryZipV2ParsedSession[] = [];
  for (const rawSession of manifest.sessions) {
    const session = parseManifestSession(rawSession);
    const sessionJsonEntry = entryByName.get(session.sessionJsonEntryName);
    if (sessionJsonEntry === undefined) {
      throw new Error(
        `Session '${session.path}' references missing JSON entry '${session.sessionJsonEntryName}'.`
      );
    }
    const previewImageEntry = entryByName.get(session.previewImageEntryName);
    if (previewImageEntry === undefined) {
      throw new Error(
        `Session '${session.path}' references missing preview entry '${session.previewImageEntryName}'.`
      );
    }

    const inferredPreviewMimeType = inferMimeTypeFromPreviewEntryName(session.previewImageEntryName);
    if (inferredPreviewMimeType !== null && inferredPreviewMimeType !== session.previewImageMimeType) {
      throw new Error(
        `Session '${session.path}' preview MIME type mismatch: manifest=${session.previewImageMimeType}, file=${inferredPreviewMimeType}`
      );
    }

    parsed.push({
      path: session.path,
      sessionJson: new TextDecoder().decode(sessionJsonEntry.data),
      previewImageBytes: previewImageEntry.data,
      previewImageMimeType: session.previewImageMimeType,
      createdAtMs: session.createdAtMs,
      updatedAtMs: session.updatedAtMs
    });
  }

  return parsed.sort((a, b) => a.path.localeCompare(b.path));
}
