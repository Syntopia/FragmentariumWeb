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
  previewFrames?: SessionGalleryManifestPreviewFrameV2[];
  createdAtMs: number;
  updatedAtMs: number;
}

interface SessionGalleryManifestPreviewFrameV2 {
  imageEntryName: string;
  imageMimeType: string;
  keyframeId: string;
  t: number;
}

export interface SessionGalleryZipV2BuildSession {
  path: string;
  sessionJson: string;
  previewImageBytes: Uint8Array;
  previewImageMimeType: string;
  previewFrames?: SessionGalleryZipV2BuildPreviewFrame[] | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SessionGalleryZipV2BuildPreviewFrame {
  imageBytes: Uint8Array;
  imageMimeType: string;
  keyframeId: string;
  t: number;
}

export interface SessionGalleryZipV2ParsedSession {
  path: string;
  sessionJson: string;
  previewImageBytes: Uint8Array;
  previewImageMimeType: string;
  previewFrames: SessionGalleryZipV2ParsedPreviewFrame[] | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SessionGalleryZipV2ParsedPreviewFrame {
  imageBytes: Uint8Array;
  imageMimeType: string;
  keyframeId: string;
  t: number;
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
    let previewFrames: SessionGalleryManifestPreviewFrameV2[] | undefined;
    if (session.previewFrames !== undefined && session.previewFrames !== null && session.previewFrames.length > 0) {
      previewFrames = [];
      for (let frameIndex = 0; frameIndex < session.previewFrames.length; frameIndex += 1) {
        const frame = session.previewFrames[frameIndex] as SessionGalleryZipV2BuildPreviewFrame;
        const frameMimeType = frame.imageMimeType.trim();
        if (frameMimeType.length === 0) {
          throw new Error(`Session '${normalizedPath}' has a preview frame with empty MIME type.`);
        }
        if (frame.keyframeId.trim().length === 0) {
          throw new Error(`Session '${normalizedPath}' has a preview frame with empty keyframeId.`);
        }
        if (!Number.isFinite(frame.t)) {
          throw new Error(`Session '${normalizedPath}' has a preview frame with invalid t value.`);
        }
        const frameExt = extensionForPreviewMimeType(frameMimeType);
        const frameEntryName = `${sessionBase}/preview-frame-${String(frameIndex).padStart(4, "0")}.${frameExt}`;
        entries.push({
          name: frameEntryName,
          data: frame.imageBytes,
          modifiedAt: new Date(session.updatedAtMs)
        });
        previewFrames.push({
          imageEntryName: frameEntryName,
          imageMimeType: frameMimeType,
          keyframeId: frame.keyframeId,
          t: frame.t
        });
      }
    }
    manifestSessions.push({
      path: normalizedPath,
      sessionJsonEntryName,
      previewImageEntryName,
      previewImageMimeType,
      previewFrames,
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
  const previewFramesRaw = source.previewFrames;
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
  let previewFrames: SessionGalleryManifestPreviewFrameV2[] | undefined;
  if (previewFramesRaw !== undefined) {
    if (!Array.isArray(previewFramesRaw)) {
      throw new Error(`Session '${path}' has invalid 'previewFrames' in ZIP manifest.`);
    }
    const parsedFrames: SessionGalleryManifestPreviewFrameV2[] = [];
    for (const rawFrame of previewFramesRaw) {
      if (typeof rawFrame !== "object" || rawFrame === null) {
        throw new Error(`Session '${path}' has a malformed preview frame entry in ZIP manifest.`);
      }
      const frame = rawFrame as Record<string, unknown>;
      const imageEntryName = frame.imageEntryName;
      const imageMimeType = frame.imageMimeType;
      const keyframeId = frame.keyframeId;
      const t = frame.t;
      if (typeof imageEntryName !== "string" || imageEntryName.trim().length === 0) {
        throw new Error(`Session '${path}' has preview frame missing imageEntryName in ZIP manifest.`);
      }
      if (typeof imageMimeType !== "string" || imageMimeType.trim().length === 0) {
        throw new Error(`Session '${path}' has preview frame missing imageMimeType in ZIP manifest.`);
      }
      if (typeof keyframeId !== "string" || keyframeId.trim().length === 0) {
        throw new Error(`Session '${path}' has preview frame missing keyframeId in ZIP manifest.`);
      }
      if (typeof t !== "number" || !Number.isFinite(t)) {
        throw new Error(`Session '${path}' has preview frame with invalid t in ZIP manifest.`);
      }
      parsedFrames.push({
        imageEntryName,
        imageMimeType,
        keyframeId,
        t
      });
    }
    previewFrames = parsedFrames.length > 0 ? parsedFrames : undefined;
  }
  return {
    path: normalizeSessionPath(path),
    sessionJsonEntryName,
    previewImageEntryName,
    previewImageMimeType,
    previewFrames,
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

    let previewFrames: SessionGalleryZipV2ParsedPreviewFrame[] | null = null;
    if (session.previewFrames !== undefined) {
      const parsedFrames: SessionGalleryZipV2ParsedPreviewFrame[] = [];
      for (const previewFrame of session.previewFrames) {
        const frameEntry = entryByName.get(previewFrame.imageEntryName);
        if (frameEntry === undefined) {
          throw new Error(
            `Session '${session.path}' references missing preview frame entry '${previewFrame.imageEntryName}'.`
          );
        }
        const inferredFrameMimeType = inferMimeTypeFromPreviewEntryName(previewFrame.imageEntryName);
        if (inferredFrameMimeType !== null && inferredFrameMimeType !== previewFrame.imageMimeType) {
          throw new Error(
            `Session '${session.path}' preview frame MIME mismatch: manifest=${previewFrame.imageMimeType}, file=${inferredFrameMimeType}`
          );
        }
        parsedFrames.push({
          imageBytes: frameEntry.data,
          imageMimeType: previewFrame.imageMimeType,
          keyframeId: previewFrame.keyframeId,
          t: previewFrame.t
        });
      }
      previewFrames = parsedFrames.length > 0 ? parsedFrames : null;
    }

    parsed.push({
      path: session.path,
      sessionJson: new TextDecoder().decode(sessionJsonEntry.data),
      previewImageBytes: previewImageEntry.data,
      previewImageMimeType: session.previewImageMimeType,
      previewFrames,
      createdAtMs: session.createdAtMs,
      updatedAtMs: session.updatedAtMs
    });
  }

  return parsed.sort((a, b) => a.path.localeCompare(b.path));
}
