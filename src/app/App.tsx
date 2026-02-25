import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { DefinitionEditor } from "../components/DefinitionEditor";
import { AppButton } from "../components/AppButton";
import { BlockingTaskDialog } from "../components/BlockingTaskDialog";
import { ConfirmDiscardChangesDialog } from "../components/ConfirmDiscardChangesDialog";
import { ConfirmDeleteLocalSystemDialog } from "../components/ConfirmDeleteLocalSystemDialog";
import { SaveLocalSystemDialog } from "../components/SaveLocalSystemDialog";
import { ExportRenderDialog, type ExportRenderDialogProgress } from "../components/ExportRenderDialog";
import { HelpDialog } from "../components/HelpDialog";
import {
  LOCAL_SESSION_GALLERY_ROOT_LABEL,
  SessionGalleryDialog,
  type SessionGalleryExternalSource,
  type SessionGalleryItem,
  type SessionGalleryStorageInfo
} from "../components/SessionGalleryDialog";
import { SplitLayout } from "../components/SplitLayout";
import {
  SystemsTreeView,
  type SystemsTreeFolderNode,
  type SystemsTreeNode
} from "../components/SystemsTreeView";
import { UniformPanel } from "../components/UniformPanel";
import { VerticalSplitLayout } from "../components/VerticalSplitLayout";
import { VerticalTabList, type VerticalTabItem } from "../components/VerticalTabList";
import { ViewportPane } from "../components/ViewportPane";
import { DEFAULT_GITHUB_SESSION_GALLERY_SOURCE_URL } from "./sessionGalleryDefaults";
import { type CameraState } from "../core/geometry/camera";
import {
  INTEGRATORS,
  getDefaultIntegratorOptions,
  getIntegratorById,
  transferSharedIntegratorOptions
} from "../core/integrators/definitions";
import type { IntegratorOptionDefinition, IntegratorOptionValues } from "../core/integrators/types";
import { formatFragmentSource } from "../core/parser/fragmentFormatter";
import { parseFragmentSource } from "../core/parser/fragmentParser";
import {
  getDefaultUniformValues,
  resolvePresetUniformValues,
  sanitizeUniformValue
} from "../core/parser/uniformState";
import type { ParseResult, ParsedPreset, UniformDefinition, UniformValue } from "../core/parser/types";
import {
  DEFAULT_RENDER_SETTINGS,
  FragmentRenderer,
  type RendererGraphicsDiagnostics,
  type RenderSettings,
  type SlicePlaneLockFrame,
  type RendererShaderErrorDetails,
  type RendererStatus
} from "../core/render/renderer";
import { FRACTAL_SYSTEMS, SYSTEM_INCLUDE_MAP, type FractalSystemDefinition } from "../systems/registry";
import { embedSessionJsonInPng, extractSessionJsonFromPng } from "../utils/pngMetadata";
import {
  listGitHubGalleryPngEntries,
  parseGitHubGalleryTreeUrl,
  type GitHubGalleryPngEntry,
  type GitHubGalleryTreeSource
} from "../utils/githubGallerySources";
import { loadGitHubGallerySourceUrls, saveGitHubGallerySourceUrls } from "../utils/githubGallerySourceStore";
import { makeUniqueSessionPath } from "../utils/sessionPathNaming";
import {
  deleteSessionSnapshotRecord,
  listSessionSnapshotRecords,
  putSessionSnapshotRecord,
  type SessionSnapshotRecord
} from "../utils/sessionSnapshotStore";
import {
  WebCodecsWebmEncoder,
  checkWebCodecsMovieSupport,
  isWebCodecsMovieExportAvailable,
  type WebCodecsMovieCodec
} from "../utils/webcodecsWebmEncoder";
import { buildZipStoreBlob, parseZipStore } from "../utils/zipStore";
import {
  applyInterpolationMode,
  buildChangedCameraSummaries,
  buildChangedUniformSummaries,
  buildInterpolatedExportState,
  formatEtaSeconds,
  type ExportInterpolationMode
} from "./exportInterpolation";
import {
  buildIntegratorOptionRenderItems,
  colorTripletPatchFromHex,
  colorTripletPatchFromIntensity,
  getColorTripletDefaultIntensity,
  getColorTripletDisplayColorHex,
  getColorTripletIntensity,
  getColorTripletIntensityStep,
  getColorTripletMax,
  supportsHdrColorTripletIntensity,
  type IntegratorColorTripletRenderItem
} from "./integratorColorTriplets";
import { selectPresetForActivation } from "./presetSelection";
import {
  appendPresetBlockToSource,
  buildFragmentariumPresetBlock,
  makeAutoPresetName
} from "./presetText";
import {
  buildSettingsClipboardPayload,
  coerceIntegratorOptionsForId,
  parseSettingsClipboardPayload,
  serializeSettingsClipboardPayloadForSessionComparison,
  serializeSettingsClipboardPayload,
  type SettingsClipboardPayload
} from "./settingsClipboard";
import { buildDefaultUniformValuesForPreset, resetPostSettingsGroup, resetRenderSettingsGroup, resetUniformGroupValues } from "./settingsReset";
import { getUniformGroupNames, normalizeUniformGroupName } from "./uniformGroups";
import buildVersion from "../../build-version.json";

const MIN_PANE_WIDTH = 240;
const MIN_LEFT_SECTION_HEIGHT = 140;
const EXPORT_STILL_TILE_THRESHOLD_PIXELS = 2048 * 2048;
const EXPORT_STILL_TILE_SIZE = 1024;
const DEFAULT_STARTUP_INTEGRATOR_ID = "de-pathtracer-physical";
const ERROR_STRIP_PREVIEW_MAX_LINES = 12;
const ERROR_STRIP_PREVIEW_MAX_CHARS = 2400;
const LOCAL_SESSION_SNAPSHOT_PREVIEW_WIDTH = 400;
const LOCAL_SESSION_SNAPSHOT_PREVIEW_SUBFRAMES = 15;
const SESSION_PNG_PREVIEW_WIDTH = 500;
const SESSION_PNG_PREVIEW_SUBFRAMES = 30;
const SESSION_GALLERY_ZIP_ROOT = "sessions";
const SESSION_GALLERY_GITHUB_ROOT_LABEL = "GitHub";
const RENDER_ASPECT_RATIO_PRESETS = [
  { id: "16:9", x: 16, y: 9, label: "16:9 (Widescreen)" },
  { id: "9:16", x: 9, y: 16, label: "9:16 (Portrait)" },
  { id: "1:1", x: 1, y: 1, label: "1:1 (Square)" },
  { id: "4:3", x: 4, y: 3, label: "4:3 (Standard)" },
  { id: "4:5", x: 4, y: 5, label: "4:5 (Vertical)" },
  { id: "2.39:1", x: 2.39, y: 1, label: "2.39:1 (Cinema)" }
] as const;
const APP_VERSION_LABEL = `v${buildVersion.version}`;
const APP_BUILD_DATE_LABEL = buildVersion.buildDate;
const APP_TITLE = `Fragmentarium Web ${APP_VERSION_LABEL} (${APP_BUILD_DATE_LABEL})`;
const LEGACY_INTEGRATOR_ID_MAP: Record<string, string> = {
  "de-pathtracer": "de-pathtracer-physical"
};
const STATIC_RIGHT_PANE_TABS: VerticalTabItem[] = [
  { id: "integrator", label: "Raytracer" },
  { id: "render", label: "Render" },
  { id: "post", label: "Post" }
];
const UNIFORM_GROUP_TAB_PREFIX = "uniform-group:";
type RightPaneTabId = string;

function makeUniformGroupTabId(group: string): string {
  return `${UNIFORM_GROUP_TAB_PREFIX}${group}`;
}

function parseUniformGroupFromTabId(tabId: string): string | null {
  if (!tabId.startsWith(UNIFORM_GROUP_TAB_PREFIX)) {
    return null;
  }
  const value = tabId.slice(UNIFORM_GROUP_TAB_PREFIX.length);
  return value.length > 0 ? value : null;
}

const defaultCamera: CameraState = {
  eye: [0, 0, -6],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 0.4
};

interface InitialState {
  leftPanePx: number;
  rightPanePx: number;
  leftSystemsPaneHeightPx: number;
  selectedSystemKey: string;
  activeIntegratorId: string;
  localSystemsByPath: Record<string, string>;
  localSessionPayloadsByPath: Record<string, SettingsClipboardPayload>;
  editorSourceBySystem: Record<string, string>;
  integratorOptionsById: Record<string, IntegratorOptionValues>;
  uniformValuesBySystem: Record<string, Record<string, UniformValue>>;
  cameraBySystem: Record<string, CameraState>;
  slicePlaneLockFrameBySystem: Record<string, SlicePlaneLockFrame | null>;
  renderSettings: RenderSettings;
  persistenceError: string | null;
}

interface LegacyPersistedState {
  leftPanePx?: number;
  rightPanePx?: number;
  leftSystemsPaneHeightPx?: number;
  selectedSystemId?: string;
  selectedSystemKey?: string;
  activeIntegratorId?: string;
  localSystemsByPath?: Record<string, string>;
  editorSourceBySystem?: Record<string, string>;
  integratorOptionsById?: Record<string, IntegratorOptionValues>;
  uniformValuesBySystem?: Record<string, Record<string, UniformValue>>;
  cameraBySystem?: Record<string, CameraState>;
  renderSettings?: Partial<RenderSettings>;
}

interface SaveLocalDialogState {
  pathValue: string;
  errorMessage: string | null;
}

interface PendingSessionPngImportState {
  fileName: string;
  payload: SettingsClipboardPayload;
}

interface LocalSessionSnapshotState {
  pngBlob: Blob;
  createdAtMs: number;
  updatedAtMs: number;
}

interface GitHubGallerySourceState {
  source: GitHubGalleryTreeSource;
  status: "idle" | "loading" | "ready" | "error";
  items: GitHubGalleryPngEntry[];
  errorMessage: string | null;
}

interface InitialGitHubGallerySourceLoadResult {
  sources: GitHubGallerySourceState[];
  errorMessage: string | null;
}

interface ToastNotification {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface EditorJumpRequest {
  line: number;
  token: number;
}

interface ExportDialogState {
  mode: "still" | "animation";
  width: number;
  height: number;
  aspectRatioLocked: boolean;
  aspectRatio: number;
  subframes: number;
  frameCount: number;
  startPresetName: string | null;
  endPresetName: string | null;
  interpolation: ExportInterpolationMode;
  previewFrame: number;
  movieCodec: WebCodecsMovieCodec;
  movieFps: number;
  movieBitrateMbps: number;
  movieKeyframeInterval: number;
  statusMessage: string | null;
}

interface ExportProgressState extends ExportRenderDialogProgress {}

interface ExportPreviewSnapshot {
  systemKey: string;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
}

interface ResolvedPresetExportState {
  presetName: string;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
}

interface ErrorStripPreview {
  text: string;
  truncated: boolean;
}

interface BlockingTaskState {
  title: string;
  message: string;
  detail: string | null;
  progress: number | null;
}

interface GalleryOriginStorageStatsState {
  originUsageBytes: number | null;
  originQuotaBytes: number | null;
  persistentStorageStatus: SessionGalleryStorageInfo["persistentStorageStatus"];
}

interface DecodedLocalSessionSnapshot {
  path: string;
  payload: SettingsClipboardPayload;
  source: string;
  snapshotPngBlob: Blob;
  createdAtMs: number;
  updatedAtMs: number;
}

const PRESET_KEY_PREFIX = "preset:";
const LOCAL_KEY_PREFIX = "local:";

function cloneUniformValue(value: UniformValue): UniformValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  return value;
}

function cloneUniformValueMap(values: Record<string, UniformValue>): Record<string, UniformValue> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cloneUniformValue(value)]));
}

function cloneCameraState(camera: CameraState): CameraState {
  return {
    eye: [...camera.eye],
    target: [...camera.target],
    up: [...camera.up],
    fov: camera.fov
  };
}

function cloneSlicePlaneLockFrame(frame: SlicePlaneLockFrame): SlicePlaneLockFrame {
  return {
    origin: [...frame.origin],
    normal: [...frame.normal]
  };
}

function cameraForwardDirection(camera: CameraState): [number, number, number] {
  const dx = camera.target[0] - camera.eye[0];
  const dy = camera.target[1] - camera.eye[1];
  const dz = camera.target[2] - camera.eye[2];
  const len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(len) || len <= 1.0e-6) {
    return [0, 0, 1];
  }
  return [dx / len, dy / len, dz / len];
}

function buildErrorStripPreview(message: string): ErrorStripPreview {
  const normalized = message.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  let preview = normalized;
  let truncated = false;

  if (lines.length > ERROR_STRIP_PREVIEW_MAX_LINES) {
    preview = lines.slice(0, ERROR_STRIP_PREVIEW_MAX_LINES).join("\n");
    truncated = true;
  }

  if (preview.length > ERROR_STRIP_PREVIEW_MAX_CHARS) {
    preview = `${preview.slice(0, ERROR_STRIP_PREVIEW_MAX_CHARS).trimEnd()}\n`;
    truncated = true;
  }

  if (truncated) {
    preview += "… (truncated in view; use Copy Error for full output)";
  }

  return { text: preview, truncated };
}

function resolvePresetExportState(
  parseResult: ParseResult,
  presetName: string,
  fallbackCamera: CameraState
): ResolvedPresetExportState | null {
  const preset = findPresetByPath(parseResult, presetName);
  if (preset === null) {
    return null;
  }
  const uniformValues = resolvePresetUniformValues(parseResult.uniforms, parseResult.presets, preset.name);
  const camera = deriveCameraFromUniformValues(parseResult.uniforms, uniformValues, fallbackCamera);
  return {
    presetName,
    uniformValues,
    camera
  };
}

function findAlternatePresetName(presetNames: string[], preferred: string | null): string | null {
  if (presetNames.length === 0) {
    return null;
  }
  if (preferred !== null) {
    for (const name of presetNames) {
      if (name !== preferred) {
        return name;
      }
    }
  }
  return presetNames[0] ?? null;
}

function sanitizeFileStem(input: string): string {
  const sanitized = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return sanitized.length > 0 ? sanitized : "fragmentarium-web";
}

function zeroPadFrameIndex(index: number, digits: number): string {
  return String(index).padStart(digits, "0");
}

function makeAnimationFrameFileName(frameIndex: number, frameCount: number): string {
  const digits = Math.max(4, String(Math.max(0, frameCount - 1)).length);
  return `frames/frame_${zeroPadFrameIndex(frameIndex, digits)}.png`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function uint8ArrayToBlob(data: Uint8Array, type: string): Blob {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Blob([buffer], { type });
}

function canvasToPngBlobLocal(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("Canvas PNG export failed."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function waitForUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (document.visibilityState === "hidden") {
      window.setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => resolve());
  });
}

function isPngFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === "image/png" || lowerName.endsWith(".png");
}

function makeLocalSessionSnapshotZipEntryName(localPath: string): string {
  const normalizedPath = normalizeLocalPath(localPath);
  if (normalizedPath === null) {
    throw new Error(`Cannot export invalid local session path '${localPath}'.`);
  }
  return `${SESSION_GALLERY_ZIP_ROOT}/${normalizedPath}.png`;
}

function parseLocalSessionSnapshotZipEntryName(entryName: string): string {
  const normalizedName = entryName.replaceAll("\\", "/");
  if (!normalizedName.toLowerCase().endsWith(".png")) {
    throw new Error(`ZIP entry '${entryName}' is not a PNG file.`);
  }
  const pathWithoutExt = normalizedName.slice(0, -4);
  const hasRootPrefix = pathWithoutExt.startsWith(`${SESSION_GALLERY_ZIP_ROOT}/`);
  const rawPath = hasRootPrefix ? pathWithoutExt.slice(SESSION_GALLERY_ZIP_ROOT.length + 1) : pathWithoutExt;
  const normalizedPath = normalizeLocalPath(rawPath);
  if (normalizedPath === null) {
    throw new Error(`ZIP entry '${entryName}' does not map to a valid session path.`);
  }
  return normalizedPath;
}

function parseEmbeddedSessionPayloadFromPngBytes(pngBytes: Uint8Array): SettingsClipboardPayload {
  const embeddedSessionJson = extractSessionJsonFromPng(pngBytes);
  if (embeddedSessionJson === null) {
    throw new Error("PNG does not contain embedded Fragmentarium Web session data.");
  }
  return parseSettingsClipboardPayload(embeddedSessionJson);
}

function requireEmbeddedSystemSource(payload: SettingsClipboardPayload, sourceLabel: string): string {
  const source = payload.systemDefinition?.source;
  if (typeof source !== "string" || source.length === 0) {
    throw new Error(`${sourceLabel} is missing embedded system source.`);
  }
  return source;
}

function loadInitialGitHubGallerySources(): InitialGitHubGallerySourceLoadResult {
  try {
    const storedUrls = loadGitHubGallerySourceUrls();
    const urls = storedUrls.length > 0 ? storedUrls : [DEFAULT_GITHUB_SESSION_GALLERY_SOURCE_URL];
    const sources: GitHubGallerySourceState[] = urls.map((url) => ({
      source: parseGitHubGalleryTreeUrl(url),
      status: "idle",
      items: [],
      errorMessage: null
    }));
    return { sources, errorMessage: null };
  } catch (error) {
    return {
      sources: [],
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

function makeGitHubGallerySourceTreePath(source: GitHubGalleryTreeSource): string {
  const folderLabel = `GH ${source.sourceLabel.replaceAll("/", " > ")}`;
  return `${SESSION_GALLERY_GITHUB_ROOT_LABEL}/${folderLabel}`;
}

async function yieldToUiFrames(frameCount = 1): Promise<void> {
  const count = Math.max(1, Math.round(frameCount));
  for (let i = 0; i < count; i += 1) {
    await waitForUiFrame();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createExportAbortErrorLocal(): Error {
  const error = new Error("Export cancelled.");
  error.name = "AbortError";
  return error;
}

function isLocalExportAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function findPresetSystemById(systemId: string): FractalSystemDefinition | null {
  return FRACTAL_SYSTEMS.find((entry) => entry.id === systemId) ?? null;
}

function getDefaultPresetEntryKey(): string {
  const defaultSystemId = FRACTAL_SYSTEMS.find((system) => system.id === "mandelbulb")?.id ?? FRACTAL_SYSTEMS[0].id;
  return makePresetEntryKey(defaultSystemId);
}

function makePresetEntryKey(systemId: string): string {
  return `${PRESET_KEY_PREFIX}${systemId}`;
}

function makeLocalEntryKey(path: string): string {
  return `${LOCAL_KEY_PREFIX}${path}`;
}

function parsePresetIdFromKey(entryKey: string): string | null {
  if (!entryKey.startsWith(PRESET_KEY_PREFIX)) {
    return null;
  }
  const value = entryKey.slice(PRESET_KEY_PREFIX.length);
  return value.length > 0 ? value : null;
}

function parseLocalPathFromKey(entryKey: string): string | null {
  if (!entryKey.startsWith(LOCAL_KEY_PREFIX)) {
    return null;
  }
  const value = entryKey.slice(LOCAL_KEY_PREFIX.length);
  return value.length > 0 ? value : null;
}

function resolvePreferredPresetEntryKeyFromPayload(payload: SettingsClipboardPayload): string | null {
  const raw = payload.systemDefinition?.selectedSystemKey;
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return null;
  }

  const embeddedPresetId = parsePresetIdFromKey(raw);
  if (embeddedPresetId !== null && findPresetSystemById(embeddedPresetId) !== null) {
    return makePresetEntryKey(embeddedPresetId);
  }

  if (findPresetSystemById(raw) !== null) {
    return makePresetEntryKey(raw);
  }

  return null;
}

function filterToLocalEditorSources(
  source: Record<string, string>,
  localSystemsByPath: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [entryKey, draft] of Object.entries(source)) {
    const localPath = parseLocalPathFromKey(entryKey);
    if (localPath === null) {
      continue;
    }
    if (localSystemsByPath[localPath] === undefined) {
      continue;
    }
    next[entryKey] = draft;
  }
  return next;
}

function normalizeLocalPath(input: string): string | null {
  const normalized = input
    .trim()
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.split("/").some((segment) => segment.trim().length === 0)) {
    return null;
  }
  return normalized;
}

function buildDefaultEditorSourceBySystem(): Record<string, string> {
  return FRACTAL_SYSTEMS.reduce<Record<string, string>>((acc, system) => {
    acc[makePresetEntryKey(system.id)] = system.source;
    return acc;
  }, {});
}

function migrateEntryKey(raw: string | undefined, localSystemsByPath: Record<string, string>): string | null {
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  if (raw.startsWith(PRESET_KEY_PREFIX) || raw.startsWith(LOCAL_KEY_PREFIX)) {
    return raw;
  }
  if (findPresetSystemById(raw) !== null) {
    return makePresetEntryKey(raw);
  }
  if (localSystemsByPath[raw] !== undefined) {
    return makeLocalEntryKey(raw);
  }
  return null;
}

function migrateRecordKeys<T>(
  source: Record<string, T> | undefined,
  localSystemsByPath: Record<string, string>
): Record<string, T> {
  if (source === undefined) {
    return {};
  }

  const next: Record<string, T> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = migrateEntryKey(rawKey, localSystemsByPath);
    if (key === null) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function renameRecordKey<T>(source: Record<string, T>, fromKey: string, toKey: string): Record<string, T> {
  if (fromKey === toKey || source[fromKey] === undefined) {
    return source;
  }
  const next = { ...source };
  next[toKey] = next[fromKey] as T;
  delete next[fromKey];
  return next;
}

function isKnownSelectionKey(entryKey: string, localSystemsByPath: Record<string, string>): boolean {
  const presetId = parsePresetIdFromKey(entryKey);
  if (presetId !== null) {
    return findPresetSystemById(presetId) !== null;
  }
  const localPath = parseLocalPathFromKey(entryKey);
  if (localPath !== null) {
    return localSystemsByPath[localPath] !== undefined;
  }
  return false;
}

function buildInitialState(): InitialState {
  return {
    leftPanePx: 380,
    rightPanePx: 380,
    leftSystemsPaneHeightPx: 220,
    selectedSystemKey: getDefaultPresetEntryKey(),
    activeIntegratorId: normalizeIntegratorId(undefined),
    localSystemsByPath: {},
    localSessionPayloadsByPath: {},
    editorSourceBySystem: buildDefaultEditorSourceBySystem(),
    integratorOptionsById: INTEGRATORS.reduce<Record<string, IntegratorOptionValues>>((acc, integrator) => {
      acc[integrator.id] = getDefaultIntegratorOptions(integrator.id);
      return acc;
    }, {}),
    uniformValuesBySystem: {},
    cameraBySystem: {},
    slicePlaneLockFrameBySystem: {},
    renderSettings: { ...DEFAULT_RENDER_SETTINGS },
    persistenceError: null
  };
}

function deriveCameraFromUniformValues(
  uniformDefinitions: UniformDefinition[],
  values: Record<string, UniformValue>,
  fallback: CameraState
): CameraState {
  const hasUniform = (name: string): boolean => uniformDefinitions.some((entry) => entry.name === name);
  const eye = hasUniform("Eye") ? asVec3(values.Eye) : null;
  const target = hasUniform("Target") ? asVec3(values.Target) : null;
  const up = hasUniform("Up") ? asVec3(values.Up) : null;
  const fov = hasUniform("FOV") ? asScalar(values.FOV) : null;

  return {
    eye: eye ?? fallback.eye,
    target: target ?? fallback.target,
    up: up ?? fallback.up,
    fov: fov ?? fallback.fov
  };
}

function coerceUniformValues(
  definitions: UniformDefinition[],
  candidate: Record<string, UniformValue> | undefined
): Record<string, UniformValue> {
  const defaults = getDefaultUniformValues(definitions);
  if (candidate === undefined) {
    return defaults;
  }

  const next = { ...defaults };
  for (const definition of definitions) {
    const raw = candidate[definition.name];
    if (raw === undefined) {
      continue;
    }
    next[definition.name] = sanitizeUniformValue(definition, raw);
  }
  return next;
}

function asVec3(value: UniformValue | undefined): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function asScalar(value: UniformValue | undefined): number | null {
  if (value === undefined || Array.isArray(value) || typeof value === "boolean") {
    return null;
  }
  return Number(value);
}

function findPresetByPath(parseResult: ParseResult | null, path: string): ParsedPreset | null {
  if (parseResult === null) {
    return null;
  }
  return parseResult.presets.find((preset) => preset.name === path) ?? null;
}

function optionStep(option: IntegratorOptionDefinition): number {
  if (option.step !== undefined) {
    return option.step;
  }
  const span = option.max - option.min;
  if (span > 100) {
    return 0.1;
  }
  if (span > 10) {
    return 0.01;
  }
  return 0.001;
}

function isNumericSliderAtDefault(value: number, baseline: number, step: number): boolean {
  const tolerance = Math.max(Math.abs(step) * 0.5, 1.0e-9);
  return Math.abs(value - baseline) <= tolerance;
}

function rangeSliderClassName(value: number, baseline: number, step: number): string {
  return isNumericSliderAtDefault(value, baseline, step) ? "slider-default" : "slider-changed";
}

function isIntegratorToggleOption(option: IntegratorOptionDefinition): boolean {
  const tolerance = 1.0e-9;
  const step = optionStep(option);
  return (
    Math.abs(option.min - 0) <= tolerance &&
    Math.abs(option.max - 1) <= tolerance &&
    Math.abs(step - 1) <= tolerance
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeIntegratorId(rawId: string | undefined): string {
  const fallbackIntegratorId = INTEGRATORS.some((integrator) => integrator.id === DEFAULT_STARTUP_INTEGRATOR_ID)
    ? DEFAULT_STARTUP_INTEGRATOR_ID
    : INTEGRATORS[0].id;
  if (rawId === undefined) {
    return fallbackIntegratorId;
  }

  const mapped = LEGACY_INTEGRATOR_ID_MAP[rawId] ?? rawId;
  return INTEGRATORS.some((integrator) => integrator.id === mapped) ? mapped : fallbackIntegratorId;
}

function normalizeIntegratorOptionsById(
  persisted: Record<string, IntegratorOptionValues> | undefined
): Record<string, IntegratorOptionValues> {
  const next = INTEGRATORS.reduce<Record<string, IntegratorOptionValues>>((acc, integrator) => {
    acc[integrator.id] = getDefaultIntegratorOptions(integrator.id);
    return acc;
  }, {});

  if (persisted === undefined) {
    return next;
  }

  for (const [rawId, options] of Object.entries(persisted)) {
    const normalizedId = LEGACY_INTEGRATOR_ID_MAP[rawId] ?? rawId;
    if (!INTEGRATORS.some((integrator) => integrator.id === normalizedId)) {
      continue;
    }
    next[normalizedId] = {
      ...next[normalizedId],
      ...options
    };
  }

  return next;
}

function coerceRenderSettings(candidate: Partial<RenderSettings> | undefined): RenderSettings {
  const source = candidate ?? {};
  const aspectRatioX = clamp(source.aspectRatioX ?? DEFAULT_RENDER_SETTINGS.aspectRatioX, 0.01, 100000);
  const aspectRatioY = clamp(source.aspectRatioY ?? DEFAULT_RENDER_SETTINGS.aspectRatioY, 0.01, 100000);
  return {
    interactionResolutionScale: clamp(
      source.interactionResolutionScale ?? DEFAULT_RENDER_SETTINGS.interactionResolutionScale,
      0.25,
      1
    ),
    maxSubframes: Math.max(0, Math.round(source.maxSubframes ?? DEFAULT_RENDER_SETTINGS.maxSubframes)),
    tileCount: Math.max(1, Math.round(source.tileCount ?? DEFAULT_RENDER_SETTINGS.tileCount)),
    tilesPerFrame: Math.max(1, Math.round(source.tilesPerFrame ?? DEFAULT_RENDER_SETTINGS.tilesPerFrame)),
    aspectRatioLocked: Math.round(clamp(source.aspectRatioLocked ?? DEFAULT_RENDER_SETTINGS.aspectRatioLocked, 0, 1)),
    aspectRatioX,
    aspectRatioY,
    toneMapping: Math.round(clamp(source.toneMapping ?? DEFAULT_RENDER_SETTINGS.toneMapping, 1, 4)),
    exposure: clamp(source.exposure ?? DEFAULT_RENDER_SETTINGS.exposure, 0, 8),
    gamma: clamp(source.gamma ?? DEFAULT_RENDER_SETTINGS.gamma, 0.2, 5),
    brightness: clamp(source.brightness ?? DEFAULT_RENDER_SETTINGS.brightness, 0, 5),
    contrast: clamp(source.contrast ?? DEFAULT_RENDER_SETTINGS.contrast, 0, 5),
    saturation: clamp(source.saturation ?? DEFAULT_RENDER_SETTINGS.saturation, 0, 5)
  };
}

function computeAspectRatioValue(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
    return null;
  }
  return x / y;
}

function estimateViewportPixelsFromStatus(status: RendererStatus): { width: number; height: number } | null {
  if (status.resolution[0] <= 0 || status.resolution[1] <= 0) {
    return null;
  }
  const scale = Number.isFinite(status.scale) && status.scale > 1e-6 ? status.scale : 1;
  return {
    width: Math.max(1, Math.round(status.resolution[0] / scale)),
    height: Math.max(1, Math.round(status.resolution[1] / scale))
  };
}

function getSourceName(entryKey: string): string {
  const presetId = parsePresetIdFromKey(entryKey);
  if (presetId !== null) {
    return `${presetId}.frag`;
  }
  const localPath = parseLocalPathFromKey(entryKey);
  if (localPath !== null) {
    const safe = localPath.replaceAll(/[^A-Za-z0-9/_-]+/g, "_");
    return `session/${safe}.frag`;
  }
  return "system.frag";
}

function findIncludeDirectiveLine(source: string, includePath: string): number | null {
  const lines = source.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*#include\s+"([^"]+)"/);
    if (match !== null && match[1] === includePath) {
      return i + 1;
    }
  }
  return null;
}

function getBaselineSourceForEntry(
  entryKey: string,
  localSystemsByPath: Record<string, string>
): string {
  const presetId = parsePresetIdFromKey(entryKey);
  if (presetId !== null) {
    return findPresetSystemById(presetId)?.source ?? "";
  }
  const localPath = parseLocalPathFromKey(entryKey);
  if (localPath !== null) {
    return localSystemsByPath[localPath] ?? "";
  }
  return "";
}

function buildSystemsTreeNodes(_localSystemsByPath: Record<string, string>): SystemsTreeNode[] {
  const presetRoot: SystemsTreeFolderNode = {
    type: "folder",
    id: "preset-root-internal",
    name: "__preset_root__",
    children: []
  };

  const normalizeBuiltInTreePath = (system: FractalSystemDefinition): string[] => {
    let segments = (system.treePath ?? `${system.category}/${system.name}`)
      .split("/")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (segments[0] === "Systems") {
      segments = segments.slice(1);
    }
    if (segments[0] === "Built-in" && segments[1] === "Fractals") {
      segments = segments.slice(2);
    } else if (segments[0] === "Built-in") {
      segments = segments.slice(1);
    }
    if (segments[0] === "Fragmentarium") {
      segments = segments.slice(1);
    }

    if (segments.length === 0) {
      segments = [system.name];
    }
    if (system.id === "mandelbulb") {
      segments = ["Mandelbulb (default)"];
    }
    return segments;
  };

  const ensurePresetFolder = (
    parent: SystemsTreeFolderNode,
    folderName: string,
    fullPath: string
  ): SystemsTreeFolderNode => {
    const existing = parent.children.find(
      (child) => child.type === "folder" && child.id === `preset-folder:${fullPath}`
    );
    if (existing !== undefined && existing.type === "folder") {
      return existing;
    }

    const next: SystemsTreeFolderNode = {
      type: "folder",
      id: `preset-folder:${fullPath}`,
      name: folderName,
      children: []
    };
    parent.children.push(next);
    return next;
  };

  for (const system of FRACTAL_SYSTEMS) {
    const treePath = normalizeBuiltInTreePath(system);

    if (treePath.length === 0) {
      continue;
    }

    let folder = presetRoot;
    for (let i = 0; i < treePath.length - 1; i += 1) {
      const name = treePath[i];
      const fullPath = treePath.slice(0, i + 1).join("/");
      folder = ensurePresetFolder(folder, name, fullPath);
    }

    const leafName = treePath[treePath.length - 1];
    folder.children.push({
      type: "leaf",
      id: `preset-leaf:${system.id}`,
      name: leafName,
      entryKey: makePresetEntryKey(system.id)
    });
  }

  const sortNodeChildren = (node: SystemsTreeFolderNode): void => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.type === "folder") {
        sortNodeChildren(child);
      }
    }
  };
  sortNodeChildren(presetRoot);
  const mandelbulbLeafIndex = presetRoot.children.findIndex(
    (node) => node.type === "leaf" && node.entryKey === makePresetEntryKey("mandelbulb")
  );
  if (mandelbulbLeafIndex > 0) {
    const [mandelbulbLeaf] = presetRoot.children.splice(mandelbulbLeafIndex, 1);
    presetRoot.children.unshift(mandelbulbLeaf);
  }

  return [...presetRoot.children];
}

export function App(): JSX.Element {
  const initial = useMemo(buildInitialState, []);
  const initialGitHubGallerySources = useMemo(loadInitialGitHubGallerySources, []);

  const [leftPanePx, setLeftPanePx] = useState(initial.leftPanePx);
  const [rightPanePx, setRightPanePx] = useState(initial.rightPanePx);
  const [leftSystemsPaneHeightPx, setLeftSystemsPaneHeightPx] = useState(initial.leftSystemsPaneHeightPx);
  const [selectedSystemKey, setSelectedSystemKey] = useState(initial.selectedSystemKey);
  const [activeIntegratorId, setActiveIntegratorId] = useState(initial.activeIntegratorId);

  const [localSystemsByPath, setLocalSystemsByPath] = useState(initial.localSystemsByPath);
  const [localSessionPayloadsByPath, setLocalSessionPayloadsByPath] = useState(initial.localSessionPayloadsByPath);
  const [localSessionSnapshotsByPath, setLocalSessionSnapshotsByPath] = useState<Record<string, LocalSessionSnapshotState>>({});
  const [localSessionPreviewUrlsByPath, setLocalSessionPreviewUrlsByPath] = useState<Record<string, string>>({});
  const [editorSourceBySystem, setEditorSourceBySystem] = useState(initial.editorSourceBySystem);
  const [uniformValuesBySystem, setUniformValuesBySystem] = useState(initial.uniformValuesBySystem);
  const [cameraBySystem, setCameraBySystem] = useState(initial.cameraBySystem);
  const [slicePlaneLockFrameBySystem, setSlicePlaneLockFrameBySystem] = useState(
    initial.slicePlaneLockFrameBySystem
  );
  const [integratorOptionsById, setIntegratorOptionsById] = useState(initial.integratorOptionsById);
  const [renderSettings, setRenderSettings] = useState(initial.renderSettings);
  const [activeRightPaneTab, setActiveRightPaneTab] = useState<RightPaneTabId>("integrator");
  const [errorClipboardStatus, setErrorClipboardStatus] = useState<string | null>(null);
  const [toastNotifications, setToastNotifications] = useState<ToastNotification[]>([]);
  const [saveLocalDialog, setSaveLocalDialog] = useState<SaveLocalDialogState | null>(null);
  const [deleteLocalDialogPath, setDeleteLocalDialogPath] = useState<string | null>(null);
  const [pendingSwitchEntryKey, setPendingSwitchEntryKey] = useState<string | null>(null);
  const [pendingSessionPngImport, setPendingSessionPngImport] = useState<PendingSessionPngImportState | null>(null);
  const [dropImportOverlayVisible, setDropImportOverlayVisible] = useState(false);
  const [definitionActionsOpen, setDefinitionActionsOpen] = useState(false);
  const [settingsCopyActionsOpen, setSettingsCopyActionsOpen] = useState(false);
  const [sessionPngExportInProgress, setSessionPngExportInProgress] = useState(false);
  const [sessionGalleryOpen, setSessionGalleryOpen] = useState(false);
  const [githubGallerySources, setGitHubGallerySources] = useState<GitHubGallerySourceState[]>(
    initialGitHubGallerySources.sources
  );
  const githubGallerySourcesRef = useRef<GitHubGallerySourceState[]>(initialGitHubGallerySources.sources);
  const [galleryOriginStorageStats, setGalleryOriginStorageStats] = useState<GalleryOriginStorageStatsState>({
    originUsageBytes: null,
    originQuotaBytes: null,
    persistentStorageStatus: "unknown"
  });
  const [githubGallerySourceLoadError, setGitHubGallerySourceLoadError] = useState<string | null>(
    initialGitHubGallerySources.errorMessage
  );
  const [persistentStorageRequestInProgress, setPersistentStorageRequestInProgress] = useState(false);
  const [blockingTask, setBlockingTask] = useState<BlockingTaskState | null>(null);
  const [exportDialogState, setExportDialogState] = useState<ExportDialogState | null>(null);
  const [exportProgressState, setExportProgressState] = useState<ExportProgressState | null>(null);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [graphicsDiagnostics, setGraphicsDiagnostics] = useState<RendererGraphicsDiagnostics | null>(null);
  const [activeUniformGroupBySystem, setActiveUniformGroupBySystem] = useState<Record<string, string>>({});
  const nextToastIdRef = useRef(1);
  const toastTimeoutIdsRef = useRef<number[]>([]);
  const definitionActionsRef = useRef<HTMLDivElement>(null);
  const settingsCopyActionsRef = useRef<HTMLDivElement>(null);
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const exportPreviewSnapshotRef = useRef<ExportPreviewSnapshot | null>(null);
  const fileDragDepthRef = useRef(0);

  const [parsedBySystem, setParsedBySystem] = useState<Record<string, ParseResult>>({});
  const [activePresetBySystem, setActivePresetBySystem] = useState<Record<string, string>>({});

  const [status, setStatus] = useState<RendererStatus>({
    fps: 0,
    subframe: 0,
    scale: 1,
    resolution: [1, 1],
    maxSubframes: renderSettings.maxSubframes,
    tileCount: renderSettings.tileCount,
    tileCursor: 0
  });
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [shaderErrorDetails, setShaderErrorDetails] = useState<RendererShaderErrorDetails | null>(null);

  useEffect(() => {
    githubGallerySourcesRef.current = githubGallerySources;
  }, [githubGallerySources]);

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);
  const [compileError, setCompileError] = useState<string | null>(initial.persistenceError);
  const [editorJumpRequest, setEditorJumpRequest] = useState<EditorJumpRequest | null>(null);
  const nextEditorJumpTokenRef = useRef(1);

  const compileErrorPreview = useMemo(
    () => (compileError !== null ? buildErrorStripPreview(compileError) : null),
    [compileError]
  );
  const shaderErrorPreview = useMemo(
    () => (shaderError !== null ? buildErrorStripPreview(shaderError) : null),
    [shaderError]
  );

  const selectedPresetId = parsePresetIdFromKey(selectedSystemKey);
  const selectedLocalPath = parseLocalPathFromKey(selectedSystemKey);
  const selectedPresetSystem = selectedPresetId !== null ? findPresetSystemById(selectedPresetId) : null;
  const selectedSystemTreePath =
    selectedPresetSystem?.treePath ??
    (selectedLocalPath !== null ? `Sessions/${selectedLocalPath}` : selectedSystemKey);
  const selectedSystemSourcePath =
    selectedPresetSystem?.sourcePath ??
    (selectedLocalPath !== null ? `session/${selectedLocalPath}.frag` : getSourceName(selectedSystemKey));

  const baselineSource = getBaselineSourceForEntry(selectedSystemKey, localSystemsByPath);
  const sourceDraft = editorSourceBySystem[selectedSystemKey] ?? baselineSource;
  const parseResult = parsedBySystem[selectedSystemKey] ?? null;
  const mappedShaderDiagnostics = shaderErrorDetails?.diagnostics.filter((entry) => entry.mappedSource !== null) ?? [];

  const activeIntegrator = getIntegratorById(activeIntegratorId);
  const activeIntegratorOptions =
    integratorOptionsById[activeIntegratorId] ?? getDefaultIntegratorOptions(activeIntegratorId);
  const groupedIntegratorOptions = useMemo(() => {
    const groups = new Map<string, IntegratorOptionDefinition[]>();
    for (const option of activeIntegrator.options) {
      const group = option.group ?? "General";
      const existing = groups.get(group);
      if (existing === undefined) {
        groups.set(group, [option]);
      } else {
        existing.push(option);
      }
    }
    return [...groups.entries()].map(([group, options]) => ({ group, options }));
  }, [activeIntegrator]);

  const viewportAspectEstimate = useMemo(
    () => estimateViewportPixelsFromStatus(status),
    [status]
  );
  const renderAspectRatioLocked = renderSettings.aspectRatioLocked >= 0.5;
  const selectedRenderAspectPresetId = useMemo(() => {
    const ratio = computeAspectRatioValue(renderSettings.aspectRatioX, renderSettings.aspectRatioY);
    if (ratio === null) {
      return "custom";
    }
    for (const preset of RENDER_ASPECT_RATIO_PRESETS) {
      const presetRatio = preset.x / preset.y;
      if (Math.abs(ratio - presetRatio) <= 1e-4) {
        return preset.id;
      }
    }
    return "custom";
  }, [renderSettings.aspectRatioX, renderSettings.aspectRatioY]);

  const uniformValues = parseResult
    ? uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms)
    : {};
  const uniformBaselineValues = useMemo(
    () =>
      parseResult === null
        ? {}
        : buildDefaultUniformValuesForPreset({
            uniforms: parseResult.uniforms,
            presets: parseResult.presets,
            selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null
          }),
    [activePresetBySystem, parseResult, selectedSystemKey]
  );
  const uniformGroups = parseResult !== null ? getUniformGroupNames(parseResult.uniforms) : [];
  const activeUniformGroupFromTab = parseUniformGroupFromTabId(activeRightPaneTab);
  const selectedUniformGroup =
    uniformGroups.length === 0
      ? null
      : activeUniformGroupFromTab !== null && uniformGroups.includes(activeUniformGroupFromTab)
        ? activeUniformGroupFromTab
        : uniformGroups.includes(activeUniformGroupBySystem[selectedSystemKey] ?? "")
        ? (activeUniformGroupBySystem[selectedSystemKey] as string)
        : uniformGroups[0];
  const visibleUniforms =
    parseResult === null || selectedUniformGroup === null
      ? []
      : parseResult.uniforms.filter(
          (uniform) => normalizeUniformGroupName(uniform.group) === selectedUniformGroup
        );
  const rightPaneTabs: VerticalTabItem[] = useMemo(
    () => [
      ...STATIC_RIGHT_PANE_TABS,
      ...uniformGroups.map((group) => ({
        id: makeUniformGroupTabId(group),
        label: group
      }))
    ],
    [uniformGroups]
  );

  const cameraState = cameraBySystem[selectedSystemKey] ?? defaultCamera;
  const slicePlaneLockFrame = slicePlaneLockFrameBySystem[selectedSystemKey] ?? null;
  const hasSourceChanges = sourceDraft !== baselineSource;
  const isEditingLocalSystem = selectedLocalPath !== null;
  const saveDialogNormalizedPath =
    saveLocalDialog === null ? null : normalizeLocalPath(saveLocalDialog.pathValue);
  const saveDialogIsOverwrite =
    saveDialogNormalizedPath !== null && localSessionPayloadsByPath[saveDialogNormalizedPath] !== undefined;

  const systemsTreeNodes = useMemo(
    () => buildSystemsTreeNodes(localSystemsByPath),
    [localSystemsByPath]
  );
  const localSessionSnapshotStorageBytes = useMemo(
    () =>
      Object.values(localSessionSnapshotsByPath).reduce(
        (sum, snapshot) => sum + Math.max(0, Math.trunc(snapshot.pngBlob.size)),
        0
      ),
    [localSessionSnapshotsByPath]
  );
  const localSessionGalleryItems = useMemo<SessionGalleryItem[]>(
    () =>
      Object.entries(localSessionSnapshotsByPath)
        .map<SessionGalleryItem | null>(([path, snapshot]) => {
          const previewUrl = localSessionPreviewUrlsByPath[path];
          if (previewUrl === undefined) {
            return null;
          }
          return {
            id: `local:${path}`,
            path: `${LOCAL_SESSION_GALLERY_ROOT_LABEL}/${path}`,
            tileLabel: path,
            previewUrl,
            createdAtMs: snapshot.createdAtMs,
            updatedAtMs: snapshot.updatedAtMs,
            sourceKind: "local",
            localPath: path
          } satisfies SessionGalleryItem;
        })
        .filter((entry): entry is SessionGalleryItem => entry !== null)
        .sort((a, b) => a.path.localeCompare(b.path)),
    [localSessionPreviewUrlsByPath, localSessionSnapshotsByPath]
  );
  const externalSessionGalleryItems = useMemo<SessionGalleryItem[]>(
    () =>
      githubGallerySources
        .flatMap((sourceState) => {
          const sourceTreePath = makeGitHubGallerySourceTreePath(sourceState.source);
          return sourceState.items.map((item) => ({
            id: `${sourceState.source.id}:${item.repoPath}`,
            path: `${sourceTreePath}/${item.relativePath}`,
            tileLabel: item.relativePath,
            previewUrl: item.downloadUrl,
            createdAtMs: null,
            updatedAtMs: 0,
            sourceKind: "github" as const,
            remotePngUrl: item.downloadUrl
          }));
        }
        )
        .sort((a, b) => a.path.localeCompare(b.path)),
    [githubGallerySources]
  );
  const sessionGalleryItems = useMemo<SessionGalleryItem[]>(
    () => [...localSessionGalleryItems, ...externalSessionGalleryItems].sort((a, b) => a.path.localeCompare(b.path)),
    [externalSessionGalleryItems, localSessionGalleryItems]
  );
  const sessionGalleryExternalSources = useMemo<SessionGalleryExternalSource[]>(
    () =>
      githubGallerySources.map((sourceState) => ({
        id: sourceState.source.id,
        label: sourceState.source.sourceLabel,
        url: sourceState.source.url,
        treePath: makeGitHubGallerySourceTreePath(sourceState.source),
        itemCount: sourceState.items.length,
        status: sourceState.status,
        errorMessage: sourceState.errorMessage
      })),
    [githubGallerySources]
  );
  const sessionGalleryStorageInfo = useMemo<SessionGalleryStorageInfo>(
    () => ({
      snapshotStorageBytes: localSessionSnapshotStorageBytes,
      originUsageBytes: galleryOriginStorageStats.originUsageBytes,
      originQuotaBytes: galleryOriginStorageStats.originQuotaBytes,
      persistentStorageStatus: galleryOriginStorageStats.persistentStorageStatus
    }),
    [galleryOriginStorageStats, localSessionSnapshotStorageBytes]
  );
  const isBlockingTaskActive = blockingTask !== null;
  const pendingSwitchTargetLabel = useMemo(() => {
    if (pendingSwitchEntryKey === null) {
      return null;
    }
    const pendingPresetId = parsePresetIdFromKey(pendingSwitchEntryKey);
    if (pendingPresetId !== null) {
      return findPresetSystemById(pendingPresetId)?.name ?? pendingPresetId;
    }
    const pendingLocalPath = parseLocalPathFromKey(pendingSwitchEntryKey);
    if (pendingLocalPath !== null) {
      return `Session/${pendingLocalPath}`;
    }
    return pendingSwitchEntryKey;
  }, [pendingSwitchEntryKey]);
  const pendingDiscardTargetLabel = useMemo(() => {
    if (pendingSessionPngImport !== null) {
      return `Session PNG/${pendingSessionPngImport.fileName}`;
    }
    return pendingSwitchTargetLabel;
  }, [pendingSessionPngImport, pendingSwitchTargetLabel]);
  const currentSessionPayloadSerialized = useMemo(
    () =>
      serializeSettingsClipboardPayloadForSessionComparison(
        buildSettingsClipboardPayload({
          selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
          integratorId: activeIntegratorId,
          integratorOptions: activeIntegratorOptions,
          renderSettings,
          uniformValues,
          camera: cameraState,
          slicePlaneLockFrame,
          systemDefinition: {
            source: sourceDraft,
            treePath: selectedSystemTreePath,
            sourcePath: selectedSystemSourcePath,
            selectedSystemKey
          }
        })
      ),
    [
      activeIntegratorId,
      activeIntegratorOptions,
      activePresetBySystem,
      cameraState,
      slicePlaneLockFrame,
      renderSettings,
      selectedSystemKey,
      selectedSystemSourcePath,
      selectedSystemTreePath,
      sourceDraft,
      uniformValues
    ]
  );
  const savedSelectedSessionPayloadSerialized =
    selectedLocalPath !== null && localSessionPayloadsByPath[selectedLocalPath] !== undefined
      ? serializeSettingsClipboardPayloadForSessionComparison(localSessionPayloadsByPath[selectedLocalPath])
      : null;
  const hasSessionChanges =
    selectedLocalPath === null ? true : currentSessionPayloadSerialized !== savedSelectedSessionPayloadSerialized;
  const canUpdateCurrentSession = isEditingLocalSystem && hasSessionChanges;
  const webCodecsMovieAvailable = isWebCodecsMovieExportAvailable();

  const exportPresetNames = parseResult?.presets.map((preset) => preset.name) ?? [];
  const exportPreviewSnapshot =
    exportPreviewSnapshotRef.current !== null && exportPreviewSnapshotRef.current.systemKey === selectedSystemKey
      ? exportPreviewSnapshotRef.current
      : null;
  const exportFallbackCamera = exportPreviewSnapshot?.camera ?? cameraState;

  const exportStartPresetState = useMemo(
    () =>
      exportDialogState !== null &&
      parseResult !== null &&
      exportDialogState.startPresetName !== null
        ? resolvePresetExportState(parseResult, exportDialogState.startPresetName, exportFallbackCamera)
        : null,
    [exportDialogState, exportFallbackCamera, parseResult]
  );

  const exportEndPresetState = useMemo(
    () =>
      exportDialogState !== null &&
      parseResult !== null &&
      exportDialogState.endPresetName !== null
        ? resolvePresetExportState(parseResult, exportDialogState.endPresetName, exportFallbackCamera)
        : null,
    [exportDialogState, exportFallbackCamera, parseResult]
  );

  const exportChangedValues = useMemo(() => {
    if (parseResult === null || exportStartPresetState === null || exportEndPresetState === null) {
      return [];
    }
    return [
      ...buildChangedCameraSummaries(exportStartPresetState.camera, exportEndPresetState.camera),
      ...buildChangedUniformSummaries(
        parseResult.uniforms,
        exportStartPresetState.uniformValues,
        exportEndPresetState.uniformValues
      )
    ];
  }, [exportEndPresetState, exportStartPresetState, parseResult]);

  const exportPreviewState = useMemo(() => {
    if (
      exportDialogState === null ||
      exportDialogState.mode !== "animation" ||
      parseResult === null ||
      exportStartPresetState === null ||
      exportEndPresetState === null
    ) {
      return null;
    }

    return buildInterpolatedExportState({
      frameIndex: exportDialogState.previewFrame,
      frameCount: exportDialogState.frameCount,
      interpolation: exportDialogState.interpolation,
      uniformDefinitions: parseResult.uniforms,
      startUniformValues: exportStartPresetState.uniformValues,
      endUniformValues: exportEndPresetState.uniformValues,
      startCamera: exportStartPresetState.camera,
      endCamera: exportEndPresetState.camera
    });
  }, [exportDialogState, exportEndPresetState, exportStartPresetState, parseResult]);

  const compileSystem = useCallback(
    (entryKey: string): void => {
      const source = editorSourceBySystem[entryKey] ?? getBaselineSourceForEntry(entryKey, localSystemsByPath);

      try {
        const parsed = parseFragmentSource({
          source,
          sourceName: getSourceName(entryKey),
          includeMap: SYSTEM_INCLUDE_MAP
        });

        const existingValues = uniformValuesBySystem[entryKey];
        let nextValues = coerceUniformValues(parsed.uniforms, existingValues);

        if (existingValues === undefined) {
          const startupPreset = selectPresetForActivation(parsed, activePresetBySystem[entryKey]);
          if (startupPreset !== null) {
            nextValues = resolvePresetUniformValues(parsed.uniforms, parsed.presets, startupPreset.name);
            setActivePresetBySystem((prev) => ({ ...prev, [entryKey]: startupPreset.name }));
          }
        }

        const fallbackCamera = cameraBySystem[entryKey] ?? defaultCamera;
        const nextCamera = deriveCameraFromUniformValues(parsed.uniforms, nextValues, fallbackCamera);

        setParsedBySystem((prev) => ({ ...prev, [entryKey]: parsed }));
        setUniformValuesBySystem((prev) => ({ ...prev, [entryKey]: nextValues }));
        setCameraBySystem((prev) => ({ ...prev, [entryKey]: nextCamera }));

        setCompileError(null);
        console.info(`[app] Compiled '${entryKey}' successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setCompileError(message);
        console.error(`[app] Compile failed for '${entryKey}': ${message}`);
      }
    },
    [activePresetBySystem, cameraBySystem, editorSourceBySystem, localSystemsByPath, uniformValuesBySystem]
  );

  useEffect(() => {
    if (parsedBySystem[selectedSystemKey] === undefined) {
      compileSystem(selectedSystemKey);
    }
  }, [compileSystem, parsedBySystem, selectedSystemKey]);

  useEffect(() => {
    setEditorJumpRequest(null);
    setDefinitionActionsOpen(false);
    setSettingsCopyActionsOpen(false);
  }, [selectedSystemKey]);

  useEffect(() => {
    if (!definitionActionsOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (definitionActionsRef.current?.contains(target)) {
        return;
      }
      setDefinitionActionsOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [definitionActionsOpen]);

  useEffect(() => {
    if (!settingsCopyActionsOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (settingsCopyActionsRef.current?.contains(target)) {
        return;
      }
      setSettingsCopyActionsOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [settingsCopyActionsOpen]);

  useEffect(() => {
    const parsed = parsedBySystem[selectedSystemKey];
    if (parsed === undefined) {
      return;
    }
    if (activePresetBySystem[selectedSystemKey] !== undefined) {
      return;
    }

    const startupPreset = selectPresetForActivation(parsed, undefined);
    if (startupPreset === null) {
      return;
    }

    const nextValues = resolvePresetUniformValues(parsed.uniforms, parsed.presets, startupPreset.name);
    const fallbackCamera = cameraBySystem[selectedSystemKey] ?? defaultCamera;
    const nextCamera = deriveCameraFromUniformValues(parsed.uniforms, nextValues, fallbackCamera);

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));
    setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextCamera }));
    setActivePresetBySystem((prev) => ({ ...prev, [selectedSystemKey]: startupPreset.name }));
  }, [
    activePresetBySystem,
    cameraBySystem,
    parsedBySystem,
    selectedSystemKey,
    uniformValuesBySystem
  ]);

  useEffect(() => {
    if (uniformGroups.length === 0 || selectedUniformGroup === null) {
      return;
    }
    if (activeUniformGroupBySystem[selectedSystemKey] === selectedUniformGroup) {
      return;
    }
    setActiveUniformGroupBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: selectedUniformGroup
    }));
  }, [
    activeUniformGroupBySystem,
    selectedSystemKey,
    selectedUniformGroup,
    uniformGroups
  ]);

  useEffect(() => {
    const hasActiveTab = rightPaneTabs.some((tab) => tab.id === activeRightPaneTab);
    if (hasActiveTab) {
      return;
    }
    if (selectedUniformGroup !== null) {
      setActiveRightPaneTab(makeUniformGroupTabId(selectedUniformGroup));
      return;
    }
    setActiveRightPaneTab(STATIC_RIGHT_PANE_TABS[0].id);
  }, [activeRightPaneTab, rightPaneTabs, selectedUniformGroup]);

  useEffect(() => {
    if (!isKnownSelectionKey(selectedSystemKey, localSystemsByPath)) {
      setSelectedSystemKey(getDefaultPresetEntryKey());
    }
  }, [localSystemsByPath, selectedSystemKey]);

  useEffect(() => {
    const lockEnabled = (activeIntegratorOptions.slicePlaneLock ?? 0) >= 0.5;
    if (lockEnabled) {
      setSlicePlaneLockFrameBySystem((prev) => {
        if (prev[selectedSystemKey] !== undefined && prev[selectedSystemKey] !== null) {
          return prev;
        }
        const captured: SlicePlaneLockFrame = {
          origin: [...cameraState.eye],
          normal: cameraForwardDirection(cameraState)
        };
        console.info(`[app] Captured locked slice plane frame for '${selectedSystemKey}'.`);
        return {
          ...prev,
          [selectedSystemKey]: captured
        };
      });
      return;
    }

    setSlicePlaneLockFrameBySystem((prev) => {
      if (prev[selectedSystemKey] === undefined || prev[selectedSystemKey] === null) {
        return prev;
      }
      console.info(`[app] Cleared locked slice plane frame for '${selectedSystemKey}'.`);
      return {
        ...prev,
        [selectedSystemKey]: null
      };
    });
  }, [activeIntegratorOptions.slicePlaneLock, cameraState, selectedSystemKey]);

  useEffect(() => {
    const urls: string[] = [];
    const nextUrls: Record<string, string> = {};
    for (const [path, snapshot] of Object.entries(localSessionSnapshotsByPath)) {
      const url = URL.createObjectURL(snapshot.pngBlob);
      urls.push(url);
      nextUrls[path] = url;
    }
    setLocalSessionPreviewUrlsByPath(nextUrls);
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [localSessionSnapshotsByPath]);

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutIdsRef.current) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutIdsRef.current = [];
      exportAbortControllerRef.current?.abort();
      exportAbortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      exportDialogState === null ||
      exportDialogState.mode !== "animation" ||
      exportPreviewState === null ||
      exportProgressState !== null
    ) {
      return;
    }

    setUniformValuesBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: cloneUniformValueMap(exportPreviewState.uniformValues)
    }));
    setCameraBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: cloneCameraState(exportPreviewState.camera)
    }));
  }, [exportDialogState, exportPreviewState, exportProgressState, selectedSystemKey]);

  const pushToast = useCallback((message: string, tone: "info" | "error" = "info"): void => {
    const id = nextToastIdRef.current;
    nextToastIdRef.current += 1;

    setToastNotifications((prev) => [...prev, { id, message, tone }]);
    const timeoutId = window.setTimeout(() => {
      setToastNotifications((prev) => prev.filter((entry) => entry.id !== id));
      toastTimeoutIdsRef.current = toastTimeoutIdsRef.current.filter((entry) => entry !== timeoutId);
    }, 5000);
    toastTimeoutIdsRef.current.push(timeoutId);
  }, []);

  useEffect(() => {
    if (githubGallerySourceLoadError === null) {
      return;
    }
    pushToast(`GitHub gallery sources failed to load: ${githubGallerySourceLoadError}`, "error");
    console.error(`[app] Failed to load persisted GitHub gallery sources: ${githubGallerySourceLoadError}`);
    setGitHubGallerySourceLoadError(null);
  }, [githubGallerySourceLoadError, pushToast]);

  useEffect(() => {
    try {
      saveGitHubGallerySourceUrls(githubGallerySources.map((entry) => entry.source.url));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Failed to save GitHub gallery source list: ${message}`, "error");
      console.error(`[app] Failed to persist GitHub gallery source list: ${message}`);
    }
  }, [githubGallerySources, pushToast]);

  const setGitHubGallerySourcesTracked = useCallback(
    (updater: (prev: GitHubGallerySourceState[]) => GitHubGallerySourceState[]): void => {
      setGitHubGallerySources((prev) => {
        const next = updater(prev);
        githubGallerySourcesRef.current = next;
        return next;
      });
    },
    []
  );

  const refreshGitHubGallerySource = useCallback(
    async (sourceToRefresh: GitHubGalleryTreeSource, showSuccessToast = true): Promise<void> => {
      const sourceId = sourceToRefresh.id;
      setGitHubGallerySourcesTracked((prev) =>
        prev.map((entry) => {
          if (entry.source.id !== sourceId) {
            return entry;
          }
          return {
            ...entry,
            status: "loading",
            items: [],
            errorMessage: null
          };
        })
      );

      console.info(`[app] Refreshing GitHub gallery source '${sourceToRefresh.sourceLabel}'.`);
      try {
        const items = await listGitHubGalleryPngEntries(sourceToRefresh);
        setGitHubGallerySourcesTracked((prev) =>
          prev.map((entry) =>
            entry.source.id === sourceId
              ? {
                  ...entry,
                  status: "ready",
                  items,
                  errorMessage: null
                }
              : entry
          )
        );
        if (showSuccessToast) {
          pushToast(
            `Loaded ${items.length} PNG preview${items.length === 1 ? "" : "s"} from ${sourceToRefresh.sourceLabel}.`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setGitHubGallerySourcesTracked((prev) =>
          prev.map((entry) =>
            entry.source.id === sourceId
              ? {
                  ...entry,
                  status: "error",
                  errorMessage: message
                }
              : entry
          )
        );
        console.error(`[app] GitHub gallery source refresh failed for '${sourceToRefresh.sourceLabel}': ${message}`);
        throw new Error(message);
      }
    },
    [pushToast, setGitHubGallerySourcesTracked]
  );

  const refreshGitHubGallerySourceById = useCallback(
    async (sourceId: string, showSuccessToast = true): Promise<void> => {
      const sourceToRefresh = githubGallerySourcesRef.current.find((entry) => entry.source.id === sourceId)?.source ?? null;
      if (sourceToRefresh === null) {
        throw new Error(`GitHub gallery source '${sourceId}' was not found.`);
      }
      await refreshGitHubGallerySource(sourceToRefresh, showSuccessToast);
    },
    [refreshGitHubGallerySource]
  );

  const onAddExternalGitHubGallerySource = useCallback(
    async (url: string): Promise<void> => {
      const parsed = parseGitHubGalleryTreeUrl(url.trim());
      if (githubGallerySourcesRef.current.some((entry) => entry.source.id === parsed.id)) {
        throw new Error(`GitHub gallery source already added: ${parsed.sourceLabel}`);
      }
      const nextSourceState: GitHubGallerySourceState = {
        source: parsed,
        status: "idle",
        items: [],
        errorMessage: null
      };
      setGitHubGallerySourcesTracked((prev) =>
        [...prev, nextSourceState].sort((a, b) => a.source.sourceLabel.localeCompare(b.source.sourceLabel))
      );

      try {
        await refreshGitHubGallerySource(parsed, false);
        pushToast(`Added GitHub gallery source: ${parsed.sourceLabel}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Added source, but initial load failed: ${message}`);
      }
    },
    [pushToast, refreshGitHubGallerySource, setGitHubGallerySourcesTracked]
  );

  const onRefreshExternalGitHubGallerySource = useCallback(
    async (sourceId: string): Promise<void> => {
      try {
        await refreshGitHubGallerySourceById(sourceId, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushToast(`GitHub source refresh failed: ${message}`, "error");
      }
    },
    [pushToast, refreshGitHubGallerySourceById]
  );

  const onRemoveExternalGitHubGallerySource = useCallback(
    (sourceId: string): void => {
      const removedSource = githubGallerySourcesRef.current.find((entry) => entry.source.id === sourceId) ?? null;
      setGitHubGallerySourcesTracked((prev) => prev.filter((entry) => entry.source.id !== sourceId));
      if (removedSource !== null) {
        pushToast(`Removed GitHub gallery source: ${removedSource.source.sourceLabel}`);
      }
    },
    [pushToast, setGitHubGallerySourcesTracked]
  );

  useEffect(() => {
    if (!sessionGalleryOpen) {
      return;
    }
    for (const source of githubGallerySources) {
      if (source.status === "idle") {
        void refreshGitHubGallerySourceById(source.source.id, false).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          pushToast(`GitHub source refresh failed: ${message}`, "error");
        });
      }
    }
  }, [githubGallerySources, pushToast, refreshGitHubGallerySourceById, sessionGalleryOpen]);

  const applyDecodedLocalSessionsSnapshot = useCallback((decodedSnapshots: DecodedLocalSessionSnapshot[]): void => {
    const nextLocalSystemsByPath: Record<string, string> = {};
    const nextLocalPayloadsByPath: Record<string, SettingsClipboardPayload> = {};
    const nextLocalSnapshotsByPath: Record<string, LocalSessionSnapshotState> = {};
    const nextLocalEditorSourceByKey: Record<string, string> = {};
    const nextLocalSliceLockByKey: Record<string, SlicePlaneLockFrame | null> = {};

    for (const snapshot of decodedSnapshots) {
      nextLocalSystemsByPath[snapshot.path] = snapshot.source;
      nextLocalPayloadsByPath[snapshot.path] = snapshot.payload;
      nextLocalSnapshotsByPath[snapshot.path] = {
        pngBlob: snapshot.snapshotPngBlob,
        createdAtMs: snapshot.createdAtMs,
        updatedAtMs: snapshot.updatedAtMs
      };
      const entryKey = makeLocalEntryKey(snapshot.path);
      nextLocalEditorSourceByKey[entryKey] = snapshot.source;
      if (snapshot.payload.slicePlaneLockFrame !== undefined) {
        nextLocalSliceLockByKey[entryKey] =
          snapshot.payload.slicePlaneLockFrame === null ? null : cloneSlicePlaneLockFrame(snapshot.payload.slicePlaneLockFrame);
      }
    }

    setLocalSystemsByPath(nextLocalSystemsByPath);
    setLocalSessionPayloadsByPath(nextLocalPayloadsByPath);
    setLocalSessionSnapshotsByPath(nextLocalSnapshotsByPath);
    setEditorSourceBySystem((prev) => {
      const next: Record<string, string> = {};
      for (const [entryKey, source] of Object.entries(prev)) {
        if (parseLocalPathFromKey(entryKey) !== null) {
          continue;
        }
        next[entryKey] = source;
      }
      return {
        ...next,
        ...nextLocalEditorSourceByKey
      };
    });
    setSlicePlaneLockFrameBySystem((prev) => {
      const next: Record<string, SlicePlaneLockFrame | null> = {};
      for (const [entryKey, frame] of Object.entries(prev)) {
        if (parseLocalPathFromKey(entryKey) !== null) {
          continue;
        }
        next[entryKey] = frame;
      }
      return {
        ...next,
        ...nextLocalSliceLockByKey
      };
    });
  }, []);

  const upsertDecodedLocalSessionSnapshots = useCallback((decodedSnapshots: DecodedLocalSessionSnapshot[]): void => {
    if (decodedSnapshots.length === 0) {
      return;
    }

    setLocalSystemsByPath((prev) => {
      const next = { ...prev };
      for (const snapshot of decodedSnapshots) {
        next[snapshot.path] = snapshot.source;
      }
      return next;
    });
    setLocalSessionPayloadsByPath((prev) => {
      const next = { ...prev };
      for (const snapshot of decodedSnapshots) {
        next[snapshot.path] = snapshot.payload;
      }
      return next;
    });
    setLocalSessionSnapshotsByPath((prev) => {
      const next = { ...prev };
      for (const snapshot of decodedSnapshots) {
        next[snapshot.path] = {
          pngBlob: snapshot.snapshotPngBlob,
          createdAtMs: snapshot.createdAtMs,
          updatedAtMs: snapshot.updatedAtMs
        };
      }
      return next;
    });
    setEditorSourceBySystem((prev) => {
      const next = { ...prev };
      for (const snapshot of decodedSnapshots) {
        next[makeLocalEntryKey(snapshot.path)] = snapshot.source;
      }
      return next;
    });
    setSlicePlaneLockFrameBySystem((prev) => {
      const next = { ...prev };
      for (const snapshot of decodedSnapshots) {
        const entryKey = makeLocalEntryKey(snapshot.path);
        next[entryKey] =
          snapshot.payload.slicePlaneLockFrame === undefined || snapshot.payload.slicePlaneLockFrame === null
            ? null
            : cloneSlicePlaneLockFrame(snapshot.payload.slicePlaneLockFrame);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      console.info("[app] Loading local session snapshots from IndexedDB.");
      try {
        const records = await listSessionSnapshotRecords();
        const decodedSnapshots: DecodedLocalSessionSnapshot[] = [];
        let invalidCount = 0;
        for (const record of records) {
          try {
            const pngBytes = await blobToUint8Array(record.pngBlob);
            const payload = parseEmbeddedSessionPayloadFromPngBytes(pngBytes);
            const source = requireEmbeddedSystemSource(payload, `Session snapshot '${record.path}'`);
            decodedSnapshots.push({
              path: record.path,
              payload,
              source,
              snapshotPngBlob: record.pngBlob,
              createdAtMs: record.createdAtMs,
              updatedAtMs: record.updatedAtMs
            });
          } catch (error) {
            invalidCount += 1;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[app] Failed to decode local session snapshot '${record.path}': ${message}`);
          }
        }
        if (cancelled) {
          return;
        }
        applyDecodedLocalSessionsSnapshot(decodedSnapshots);
        console.info(`[app] Loaded ${decodedSnapshots.length} local session snapshot(s) from IndexedDB.`);
        if (invalidCount > 0) {
          pushToast(`Skipped ${invalidCount} invalid saved session snapshot${invalidCount === 1 ? "" : "s"}.`, "error");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        pushToast(`Local session snapshot load failed: ${message}`, "error");
        console.error(`[app] Failed to load local session snapshots: ${message}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyDecodedLocalSessionsSnapshot, pushToast]);

  useEffect(() => {
    if (!sessionGalleryOpen) {
      return;
    }

    const storageManager = navigator.storage;
    if (storageManager === undefined) {
      setGalleryOriginStorageStats({
        originUsageBytes: null,
        originQuotaBytes: null,
        persistentStorageStatus: "unavailable"
      });
      return;
    }

    let cancelled = false;
    setGalleryOriginStorageStats((prev) => ({
      ...prev,
      persistentStorageStatus:
        prev.persistentStorageStatus === "unavailable" ? "unavailable" : "unknown"
    }));

    void (async () => {
      try {
        const [estimate, persisted] = await Promise.all([
          storageManager.estimate().catch(() => null),
          typeof storageManager.persisted === "function" ? storageManager.persisted().catch(() => null) : Promise.resolve(null)
        ]);

        if (cancelled) {
          return;
        }

        setGalleryOriginStorageStats({
          originUsageBytes:
            estimate !== null && typeof estimate.usage === "number" && Number.isFinite(estimate.usage)
              ? estimate.usage
              : null,
          originQuotaBytes:
            estimate !== null && typeof estimate.quota === "number" && Number.isFinite(estimate.quota)
              ? estimate.quota
              : null,
          persistentStorageStatus:
            persisted === null ? "unknown" : persisted ? "enabled" : "disabled"
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error(
          `[app] Failed to query browser storage estimate for gallery: ${error instanceof Error ? error.message : String(error)}`
        );
        setGalleryOriginStorageStats((prev) => ({
          ...prev,
          persistentStorageStatus:
            prev.persistentStorageStatus === "unavailable" ? "unavailable" : "unknown"
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localSessionSnapshotsByPath, sessionGalleryOpen]);

  const onRequestPersistentStorage = async (): Promise<void> => {
    if (persistentStorageRequestInProgress) {
      return;
    }

    const storageManager = navigator.storage;
    if (storageManager === undefined || typeof storageManager.persist !== "function") {
      setGalleryOriginStorageStats((prev) => ({
        ...prev,
        persistentStorageStatus: "unavailable"
      }));
      pushToast("Persistent storage request is unavailable in this browser.", "error");
      console.error("[app] navigator.storage.persist() is unavailable.");
      return;
    }

    setPersistentStorageRequestInProgress(true);
    console.info("[app] Requesting persistent storage for this origin.");
    try {
      const granted = await storageManager.persist();
      const [estimate, persisted] = await Promise.all([
        storageManager.estimate().catch(() => null),
        typeof storageManager.persisted === "function" ? storageManager.persisted().catch(() => null) : Promise.resolve(null)
      ]);

      setGalleryOriginStorageStats({
        originUsageBytes:
          estimate !== null && typeof estimate.usage === "number" && Number.isFinite(estimate.usage) ? estimate.usage : null,
        originQuotaBytes:
          estimate !== null && typeof estimate.quota === "number" && Number.isFinite(estimate.quota) ? estimate.quota : null,
        persistentStorageStatus:
          persisted === null ? (granted ? "enabled" : "unknown") : persisted ? "enabled" : "disabled"
      });

      if (granted) {
        pushToast("Persistent storage enabled for this browser origin.");
        console.info("[app] Persistent storage request granted.");
      } else {
        pushToast("Persistent storage request was not granted by the browser.", "error");
        console.info("[app] Persistent storage request not granted.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Persistent storage request failed: ${message}`, "error");
      console.error(`[app] Persistent storage request failed: ${message}`);
    } finally {
      setPersistentStorageRequestInProgress(false);
    }
  };

  const onViewportError = useCallback((error: RendererShaderErrorDetails | string | null): void => {
    if (error === null) {
      setShaderError(null);
      setShaderErrorDetails(null);
      return;
    }
    if (typeof error === "string") {
      setShaderError(error);
      setShaderErrorDetails(null);
      return;
    }
    setShaderError(error.message);
    setShaderErrorDetails(error);
  }, []);

  const onJumpToShaderDiagnostic = useCallback(
    (diagnosticIndex: number): void => {
      const diagnostic = mappedShaderDiagnostics[diagnosticIndex];
      if (diagnostic === undefined || diagnostic.mappedSource === null) {
        return;
      }
      const mapped = diagnostic.mappedSource;
      let targetLine: number | null = null;

      if (parseResult !== null && mapped.path === parseResult.sourceName) {
        targetLine = mapped.line;
      } else if (mapped.path === selectedSystemSourcePath || mapped.path === getSourceName(selectedSystemKey)) {
        targetLine = mapped.line;
      } else {
        targetLine = findIncludeDirectiveLine(sourceDraft, mapped.path);
        if (targetLine !== null) {
          pushToast(`Error is in include '${mapped.path}' line ${mapped.line}. Jumped to #include line.`);
        } else {
          pushToast(`Mapped error: ${mapped.path}:${mapped.line}`, "error");
          return;
        }
      }

      const token = nextEditorJumpTokenRef.current;
      nextEditorJumpTokenRef.current += 1;
      setEditorJumpRequest({
        line: targetLine,
        token
      });
    },
    [mappedShaderDiagnostics, parseResult, pushToast, selectedSystemKey, selectedSystemSourcePath, sourceDraft]
  );

  const onApplyPreset = (path: string): void => {
    if (parseResult === null) {
      return;
    }
    const preset = findPresetByPath(parseResult, path);
    if (preset === null) {
      return;
    }

    const nextValues = resolvePresetUniformValues(parseResult.uniforms, parseResult.presets, preset.name);

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));

    const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextValues, cameraState);
    setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextCamera }));
    setActivePresetBySystem((prev) => ({ ...prev, [selectedSystemKey]: path }));
  };

  const onUniformValueChange = (name: string, value: UniformValue): void => {
    if (parseResult === null) {
      return;
    }

    const definition = parseResult.uniforms.find((entry) => entry.name === name);
    if (definition === undefined) {
      return;
    }

    const sanitized = sanitizeUniformValue(definition, value);
    const currentValues = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextValues = {
      ...currentValues,
      [name]: sanitized
    };

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));

    if (name === "Eye" || name === "Target" || name === "Up" || name === "FOV") {
      const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextValues, cameraState);
      setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextCamera }));
    }
  };

  const onCameraChange = (next: CameraState): void => {
    setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: next }));

    if (parseResult === null) {
      return;
    }

    const definitions = new Set(parseResult.uniforms.map((entry) => entry.name));
    if (!definitions.has("Eye") && !definitions.has("Target") && !definitions.has("Up") && !definitions.has("FOV")) {
      return;
    }

    const currentValues = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextValues = {
      ...currentValues
    };

    if (definitions.has("Eye")) {
      nextValues.Eye = [...next.eye];
    }
    if (definitions.has("Target")) {
      nextValues.Target = [...next.target];
    }
    if (definitions.has("Up")) {
      nextValues.Up = [...next.up];
    }
    if (definitions.has("FOV")) {
      nextValues.FOV = next.fov;
    }

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));
  };

  const onFocusDistance = (distance: number | null): void => {
    if (distance === null || !Number.isFinite(distance) || distance <= 0) {
      pushToast("Focus probe: no hit detected at screen center.", "error");
      return;
    }

    let applied = false;
    let appliedDistance = distance;

    const focalOption = activeIntegrator.options.find((option) => option.key === "focalDistance");
    if (focalOption !== undefined) {
      const clamped = clamp(distance, focalOption.min, focalOption.max);
      setIntegratorOptionsById((prev) => ({
        ...prev,
        [activeIntegratorId]: {
          ...(prev[activeIntegratorId] ?? getDefaultIntegratorOptions(activeIntegratorId)),
          focalDistance: clamped
        }
      }));
      applied = true;
      appliedDistance = clamped;
    }

    if (parseResult === null) {
      pushToast(`Focus distance ${appliedDistance.toFixed(3)}.`);
      return;
    }

    const focalPlaneDefinition = parseResult.uniforms.find((entry) => entry.name === "FocalPlane");
    if (focalPlaneDefinition === undefined) {
      if (applied) {
        pushToast(`Focus set to ${appliedDistance.toFixed(3)}.`);
      } else {
        pushToast(`Focus distance ${appliedDistance.toFixed(3)}.`);
      }
      return;
    }

    const currentValues = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextValues = {
      ...currentValues,
      FocalPlane: sanitizeUniformValue(focalPlaneDefinition, distance)
    };
    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));
    applied = true;

    if (applied) {
      pushToast(`Focus set to ${appliedDistance.toFixed(3)}.`);
    } else {
      pushToast(`Focus distance ${appliedDistance.toFixed(3)}.`);
    }
  };

  const onIntegratorOptionChange = (key: string, value: number): void => {
    setIntegratorOptionsById((prev) => ({
      ...prev,
      [activeIntegratorId]: {
        ...(prev[activeIntegratorId] ?? getDefaultIntegratorOptions(activeIntegratorId)),
        [key]: value
      }
    }));
  };

  const onIntegratorOptionPatch = (patch: Record<string, number>): void => {
    setIntegratorOptionsById((prev) => ({
      ...prev,
      [activeIntegratorId]: {
        ...(prev[activeIntegratorId] ?? getDefaultIntegratorOptions(activeIntegratorId)),
        ...patch
      }
    }));
  };

  const onRenderSettingChange = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]): void => {
    setRenderSettings((prev) => coerceRenderSettings({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (renderSettings.aspectRatioLocked >= 0.5) {
      return;
    }
    if (viewportAspectEstimate === null) {
      return;
    }
    setRenderSettings((prev) => {
      if (prev.aspectRatioLocked >= 0.5) {
        return prev;
      }
      if (prev.aspectRatioX === viewportAspectEstimate.width && prev.aspectRatioY === viewportAspectEstimate.height) {
        return prev;
      }
      return {
        ...prev,
        aspectRatioX: viewportAspectEstimate.width,
        aspectRatioY: viewportAspectEstimate.height
      };
    });
  }, [renderSettings.aspectRatioLocked, viewportAspectEstimate]);

  const onRenderAspectRatioLockChange = (locked: boolean): void => {
    setRenderSettings((prev) => {
      if (locked) {
        const sync = viewportAspectEstimate;
        const nextX =
          sync !== null && prev.aspectRatioLocked < 0.5 ? sync.width : prev.aspectRatioX;
        const nextY =
          sync !== null && prev.aspectRatioLocked < 0.5 ? sync.height : prev.aspectRatioY;
        return coerceRenderSettings({
          ...prev,
          aspectRatioLocked: 1,
          aspectRatioX: nextX,
          aspectRatioY: nextY
        });
      }
      return coerceRenderSettings({
        ...prev,
        aspectRatioLocked: 0
      });
    });
  };

  const onRenderAspectRatioPartChange = (key: "aspectRatioX" | "aspectRatioY", value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    setRenderSettings((prev) =>
      coerceRenderSettings({
        ...prev,
        [key]: value,
        aspectRatioLocked: 1
      })
    );
  };

  const onRenderAspectRatioPresetChange = (presetId: string): void => {
    if (presetId === "custom") {
      return;
    }
    const preset = RENDER_ASPECT_RATIO_PRESETS.find((entry) => entry.id === presetId);
    if (preset === undefined) {
      return;
    }
    setRenderSettings((prev) =>
      coerceRenderSettings({
        ...prev,
        aspectRatioLocked: 1,
        aspectRatioX: preset.x,
        aspectRatioY: preset.y
      })
    );
  };

  const onResetActiveIntegratorOptions = (): void => {
    setIntegratorOptionsById((prev) => ({
      ...prev,
      [activeIntegratorId]: getDefaultIntegratorOptions(activeIntegratorId)
    }));
  };

  const onResetRenderGroupSettings = (): void => {
    setRenderSettings((prev) => resetRenderSettingsGroup(prev));
  };

  const onResetPostGroupSettings = (): void => {
    setRenderSettings((prev) => resetPostSettingsGroup(prev));
  };

  const onResetActiveUniformGroupSettings = (): void => {
    if (parseResult === null || selectedUniformGroup === null) {
      return;
    }

    const currentValues = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextUniformValues = resetUniformGroupValues({
      uniforms: parseResult.uniforms,
      presets: parseResult.presets,
      selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
      currentValues,
      groupName: selectedUniformGroup
    });
    const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextUniformValues, cameraState);

    setUniformValuesBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: nextUniformValues
    }));
    setCameraBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: nextCamera
    }));
  };

  const onResetAllSettings = (): void => {
    setSettingsCopyActionsOpen(false);
    onResetActiveIntegratorOptions();
    setRenderSettings({ ...DEFAULT_RENDER_SETTINGS });

    if (parseResult !== null) {
      const nextUniformValues = buildDefaultUniformValuesForPreset({
        uniforms: parseResult.uniforms,
        presets: parseResult.presets,
        selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null
      });
      const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextUniformValues, cameraState);

      setUniformValuesBySystem((prev) => ({
        ...prev,
        [selectedSystemKey]: nextUniformValues
      }));
      setCameraBySystem((prev) => ({
        ...prev,
        [selectedSystemKey]: nextCamera
      }));
    }

    pushToast("Session settings reset to defaults.");
    console.info(`[app] Reset session settings to defaults for '${selectedSystemKey}'.`);
  };

  const restoreExportPreviewSnapshot = useCallback((): void => {
    const snapshot = exportPreviewSnapshotRef.current;
    if (snapshot === null) {
      return;
    }
    exportPreviewSnapshotRef.current = null;
    setUniformValuesBySystem((prev) => ({
      ...prev,
      [snapshot.systemKey]: cloneUniformValueMap(snapshot.uniformValues)
    }));
    setCameraBySystem((prev) => ({
      ...prev,
      [snapshot.systemKey]: cloneCameraState(snapshot.camera)
    }));
  }, []);

  const onOpenExportDialog = (): void => {
    if (parseResult === null) {
      pushToast("Compile a system before exporting.", "error");
      return;
    }

    exportPreviewSnapshotRef.current = {
      systemKey: selectedSystemKey,
      uniformValues: cloneUniformValueMap(uniformValues),
      camera: cloneCameraState(cameraState)
    };

    const activePresetName = activePresetBySystem[selectedSystemKey] ?? parseResult.presets[0]?.name ?? null;
    const startPresetName = activePresetName;
    const endPresetName = findAlternatePresetName(parseResult.presets.map((preset) => preset.name), activePresetName);
    const estimatedWidth =
      status.resolution[0] > 1 && status.scale > 0.01 ? Math.round(status.resolution[0] / status.scale) : 1920;
    const estimatedHeight =
      status.resolution[1] > 1 && status.scale > 0.01 ? Math.round(status.resolution[1] / status.scale) : 1080;
    const renderAspectRatio = computeAspectRatioValue(renderSettings.aspectRatioX, renderSettings.aspectRatioY);
    const exportAspectRatio =
      renderSettings.aspectRatioLocked >= 0.5 && renderAspectRatio !== null
        ? renderAspectRatio
        : Math.max(1, estimatedWidth) / Math.max(1, estimatedHeight);
    const exportWidth = Math.max(1, estimatedWidth);
    const exportHeight = Math.max(1, estimatedHeight);

    setExportDialogState({
      mode: "still",
      width: exportWidth,
      height: exportHeight,
      aspectRatioLocked: true,
      aspectRatio: exportAspectRatio,
      subframes: renderSettings.maxSubframes > 0 ? renderSettings.maxSubframes : 30,
      frameCount: 100,
      startPresetName,
      endPresetName,
      interpolation: "linear",
      previewFrame: 0,
      movieCodec: "vp9",
      movieFps: 30,
      movieBitrateMbps: 12,
      movieKeyframeInterval: 30,
      statusMessage: null
    });
    setExportProgressState(null);
  };

  const onCloseExportDialog = (): void => {
    if (exportProgressState !== null) {
      return;
    }
    restoreExportPreviewSnapshot();
    setExportDialogState(null);
    setExportProgressState(null);
  };

  const onCancelExportRender = (): void => {
    exportAbortControllerRef.current?.abort();
    if (exportDialogState !== null) {
      setExportDialogState((prev) => (prev === null ? prev : { ...prev, statusMessage: "Cancelling export..." }));
    }
  };

  const onStartMovieExportRender = async (): Promise<void> => {
    if (exportDialogState === null) {
      return;
    }
    if (parseResult === null) {
      updateExportDialogState({ statusMessage: "Cannot export movie: system is not compiled." });
      return;
    }

    const dialogSnapshot = { ...exportDialogState };
    if (
      dialogSnapshot.mode !== "animation" ||
      exportStartPresetState === null ||
      exportEndPresetState === null ||
      dialogSnapshot.startPresetName === null ||
      dialogSnapshot.endPresetName === null
    ) {
      updateExportDialogState({ statusMessage: "Movie export requires Animation mode and two presets." });
      return;
    }

    const movieSupport = await checkWebCodecsMovieSupport({
      width: dialogSnapshot.width,
      height: dialogSnapshot.height,
      fps: dialogSnapshot.movieFps,
      bitrateMbps: dialogSnapshot.movieBitrateMbps,
      keyframeInterval: dialogSnapshot.movieKeyframeInterval,
      codec: dialogSnapshot.movieCodec
    });
    if (!movieSupport.supported || movieSupport.config === null) {
      updateExportDialogState({
        statusMessage: `Movie export unavailable: ${movieSupport.reason ?? "Unsupported WebCodecs configuration."}`
      });
      pushToast(`Movie export unavailable: ${movieSupport.reason ?? "Unsupported configuration."}`, "error");
      return;
    }

    const abortController = new AbortController();
    exportAbortControllerRef.current = abortController;
    const totalFrames = Math.max(1, dialogSnapshot.frameCount);
    setExportProgressState({
      overallProgress: 0,
      currentFrameIndex: 0,
      totalFrames,
      etaLabel: "Estimating…",
      stageLabel: "Preparing movie encoder..."
    });
    updateExportDialogState({ statusMessage: "Preparing WebCodecs movie export..." });
    await yieldToUiFrames();

    const exportStartedMs = performance.now();
    const updateProgress = (overallProgress: number, currentFrameIndex: number, stageLabel: string): void => {
      const clampedProgress = Math.max(0, Math.min(1, overallProgress));
      const elapsedSec = Math.max((performance.now() - exportStartedMs) / 1000, 1e-3);
      const etaSec = clampedProgress > 1.0e-4 ? (elapsedSec * (1 - clampedProgress)) / clampedProgress : null;
      setExportProgressState({
        overallProgress: clampedProgress,
        currentFrameIndex,
        totalFrames,
        etaLabel: formatEtaSeconds(etaSec),
        stageLabel
      });
    };

    const offscreenCanvas = document.createElement("canvas");
    let exportRenderer: FragmentRenderer | null = null;
    let movieEncoder: WebCodecsWebmEncoder | null = null;

    try {
      exportRenderer = new FragmentRenderer(offscreenCanvas, {
        onStatus: () => {
          // no-op for offscreen export
        }
      });

      exportRenderer.setRenderSettings({
        ...renderSettings,
        interactionResolutionScale: 1,
        tileCount: 1,
        tilesPerFrame: 1,
        maxSubframes: Math.max(1, dialogSnapshot.subframes)
      });
      exportRenderer.setScene({
        geometrySource: parseResult.shaderSource,
        geometryLineMap: parseResult.shaderLineMap,
        uniformDefinitions: parseResult.uniforms,
        uniformValues: uniformValues,
        integrator: activeIntegrator,
        integratorOptions: activeIntegratorOptions
      });
      exportRenderer.updateSlicePlaneLockFrame(slicePlaneLockFrame);

      movieEncoder = new WebCodecsWebmEncoder(
        {
          width: dialogSnapshot.width,
          height: dialogSnapshot.height,
          fps: dialogSnapshot.movieFps,
          bitrateMbps: dialogSnapshot.movieBitrateMbps,
          keyframeInterval: dialogSnapshot.movieKeyframeInterval,
          codec: dialogSnapshot.movieCodec
        },
        movieSupport.config
      );

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        if (abortController.signal.aborted) {
          throw createExportAbortErrorLocal();
        }

        const interpolated = buildInterpolatedExportState({
          frameIndex,
          frameCount: totalFrames,
          interpolation: dialogSnapshot.interpolation,
          uniformDefinitions: parseResult.uniforms,
          startUniformValues: exportStartPresetState.uniformValues,
          endUniformValues: exportEndPresetState.uniformValues,
          startCamera: exportStartPresetState.camera,
          endCamera: exportEndPresetState.camera
        });

        exportRenderer.updateIntegratorOptions(activeIntegratorOptions);
        exportRenderer.updateUniformValues(interpolated.uniformValues);
        exportRenderer.setCamera(interpolated.camera);

        await exportRenderer.renderStill({
          width: dialogSnapshot.width,
          height: dialogSnapshot.height,
          subframes: Math.max(1, dialogSnapshot.subframes),
          signal: abortController.signal,
          onProgress: (progress) => {
            const perFrame = 1 / totalFrames;
            const overall = frameIndex * perFrame + progress.progress * perFrame * 0.9;
            updateProgress(
              overall,
              frameIndex,
              `Rendering frame ${frameIndex + 1}/${totalFrames} (${progress.subframe}/${progress.totalSubframes} subframes)`
            );
          },
          timeSeconds: 0
        });

        if (abortController.signal.aborted) {
          throw createExportAbortErrorLocal();
        }

        updateProgress(
          (frameIndex + 0.9) / totalFrames,
          frameIndex,
          `Encoding frame ${frameIndex + 1}/${totalFrames} (${dialogSnapshot.movieCodec.toUpperCase()})`
        );
        await movieEncoder.encodeCanvasFrame(offscreenCanvas, frameIndex);
        await yieldToUiFrames();
      }

      updateProgress(0.97, totalFrames - 1, "Finalizing video stream...");
      await yieldToUiFrames();
      const movieBlob = await movieEncoder.finalizeBlob();
      movieEncoder = null;

      const systemStem = sanitizeFileStem(selectedSystemTreePath);
      downloadBlob(
        movieBlob,
        `${systemStem}_${dialogSnapshot.width}x${dialogSnapshot.height}_${totalFrames}f_${dialogSnapshot.movieFps}fps.webm`
      );
      updateProgress(1, totalFrames - 1, "Movie exported.");
      updateExportDialogState({ statusMessage: "Movie exported as WebM (WebCodecs)." });
      pushToast(`Movie export complete (${totalFrames} frames, ${dialogSnapshot.movieCodec.toUpperCase()}).`);
      await yieldToUiFrames(2);
    } catch (error) {
      if (isAbortError(error) || isLocalExportAbortError(error)) {
        updateExportDialogState({ statusMessage: "Movie export cancelled." });
        pushToast("Movie export cancelled.");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        updateExportDialogState({ statusMessage: `Movie export failed: ${message}` });
        pushToast(`Movie export failed: ${message}`, "error");
        console.error(`[app] Movie export failed for '${selectedSystemKey}': ${message}`);
      }
    } finally {
      exportAbortControllerRef.current = null;
      setExportProgressState(null);
      movieEncoder?.close();
      exportRenderer?.destroy();
    }
  };

  const updateExportDialogState = (patch: Partial<ExportDialogState>): void => {
    setExportDialogState((prev) => {
      if (prev === null) {
        return prev;
      }
      return {
        ...prev,
        ...patch
      };
    });
  };

  const onExportWidthChange = (value: number): void => {
    setExportDialogState((prev) => {
      if (prev === null) {
        return prev;
      }
      const width = Math.max(1, Math.round(value));
      if (!prev.aspectRatioLocked) {
        return { ...prev, width, statusMessage: null };
      }
      const ratio = Number.isFinite(prev.aspectRatio) && prev.aspectRatio > 1e-6 ? prev.aspectRatio : width / prev.height;
      const height = Math.max(1, Math.round(width / ratio));
      return { ...prev, width, height, aspectRatio: ratio, statusMessage: null };
    });
  };

  const onExportHeightChange = (value: number): void => {
    setExportDialogState((prev) => {
      if (prev === null) {
        return prev;
      }
      const height = Math.max(1, Math.round(value));
      if (!prev.aspectRatioLocked) {
        return { ...prev, height, statusMessage: null };
      }
      const ratio = Number.isFinite(prev.aspectRatio) && prev.aspectRatio > 1e-6 ? prev.aspectRatio : prev.width / height;
      const width = Math.max(1, Math.round(height * ratio));
      return { ...prev, width, height, aspectRatio: ratio, statusMessage: null };
    });
  };

  const onExportAspectRatioLockChange = (locked: boolean): void => {
    setExportDialogState((prev) => {
      if (prev === null) {
        return prev;
      }
      return {
        ...prev,
        aspectRatioLocked: locked,
        aspectRatio: locked ? Math.max(1, prev.width) / Math.max(1, prev.height) : prev.aspectRatio,
        statusMessage: null
      };
    });
  };

  const onStartExportRender = async (): Promise<void> => {
    if (exportDialogState === null) {
      return;
    }
    if (parseResult === null) {
      updateExportDialogState({ statusMessage: "Cannot export: system is not compiled." });
      return;
    }

    const dialogSnapshot = { ...exportDialogState };
    const exportMode = dialogSnapshot.mode;
    const canAnimate =
      exportMode === "animation" &&
      exportStartPresetState !== null &&
      exportEndPresetState !== null &&
      dialogSnapshot.startPresetName !== null &&
      dialogSnapshot.endPresetName !== null;

    const abortController = new AbortController();
    exportAbortControllerRef.current = abortController;
    setExportProgressState({
      overallProgress: 0,
      currentFrameIndex: 0,
      totalFrames: exportMode === "animation" ? Math.max(1, dialogSnapshot.frameCount) : 1,
      etaLabel: "Estimating…",
      stageLabel: "Preparing renderer..."
    });
    updateExportDialogState({ statusMessage: "Preparing export..." });
    await yieldToUiFrames();

    const exportStartedMs = performance.now();
    const STILL_RENDER_PROGRESS_START = 0.02;
    const STILL_RENDER_PROGRESS_END = 0.86;
    const STILL_READBACK_PROGRESS = 0.91;
    const STILL_ENCODE_PROGRESS = 0.965;
    const STILL_METADATA_PROGRESS = 0.985;
    const STILL_DOWNLOAD_PREP_PROGRESS = 0.995;

    const updateProgress = (overallProgress: number, currentFrameIndex: number, totalFrames: number, stageLabel: string): void => {
      const clampedProgress = Math.max(0, Math.min(1, overallProgress));
      const elapsedSec = Math.max((performance.now() - exportStartedMs) / 1000, 1e-3);
      const etaSec = clampedProgress > 1.0e-4 ? (elapsedSec * (1 - clampedProgress)) / clampedProgress : null;
      setExportProgressState({
        overallProgress: clampedProgress,
        currentFrameIndex,
        totalFrames,
        etaLabel: formatEtaSeconds(etaSec),
        stageLabel
      });
    };

    const offscreenCanvas = document.createElement("canvas");
    let exportRenderer: FragmentRenderer | null = null;

    try {
      exportRenderer = new FragmentRenderer(offscreenCanvas, {
        onStatus: () => {
          // no-op for offscreen export
        }
      });

      exportRenderer.setRenderSettings({
        ...renderSettings,
        interactionResolutionScale: 1,
        tileCount: 1,
        tilesPerFrame: 1,
        maxSubframes: Math.max(1, dialogSnapshot.subframes)
      });
      exportRenderer.setScene({
        geometrySource: parseResult.shaderSource,
        geometryLineMap: parseResult.shaderLineMap,
        uniformDefinitions: parseResult.uniforms,
        uniformValues: uniformValues,
        integrator: activeIntegrator,
        integratorOptions: activeIntegratorOptions
      });
      exportRenderer.updateSlicePlaneLockFrame(slicePlaneLockFrame);

      const systemStem = sanitizeFileStem(selectedSystemTreePath);

      if (!canAnimate) {
        exportRenderer.updateIntegratorOptions(activeIntegratorOptions);
        exportRenderer.updateUniformValues(uniformValues);
        exportRenderer.setCamera(cameraState);
        const totalPixels = dialogSnapshot.width * dialogSnapshot.height;
        const useTiledStillExport = totalPixels > EXPORT_STILL_TILE_THRESHOLD_PIXELS;
        const subframes = Math.max(1, dialogSnapshot.subframes);
        let pngBlob: Blob;

        if (useTiledStillExport) {
          const outputCanvas = document.createElement("canvas");
          outputCanvas.width = dialogSnapshot.width;
          outputCanvas.height = dialogSnapshot.height;
          const ctx2d = outputCanvas.getContext("2d");
          if (ctx2d === null) {
            throw new Error("2D canvas context is unavailable for tiled export.");
          }

          const tileSize = EXPORT_STILL_TILE_SIZE;
          const tilesX = Math.max(1, Math.ceil(dialogSnapshot.width / tileSize));
          const tilesY = Math.max(1, Math.ceil(dialogSnapshot.height / tileSize));
          const totalTiles = tilesX * tilesY;

          for (let tileIndex = 0; tileIndex < totalTiles; tileIndex += 1) {
            if (abortController.signal.aborted) {
              throw createExportAbortErrorLocal();
            }

            const tileXIndex = tileIndex % tilesX;
            const tileYIndex = Math.floor(tileIndex / tilesX);
            const x = tileXIndex * tileSize;
            const topY = tileYIndex * tileSize;
            const tileWidth = Math.min(tileSize, dialogSnapshot.width - x);
            const tileHeight = Math.min(tileSize, dialogSnapshot.height - topY);
            const pixelOffsetY = dialogSnapshot.height - topY - tileHeight;

            exportRenderer.setCameraRayViewportOverride(
              [dialogSnapshot.width, dialogSnapshot.height],
              [x, pixelOffsetY]
            );

            await exportRenderer.renderStill({
              width: tileWidth,
              height: tileHeight,
              subframes,
              signal: abortController.signal,
              onProgress: (progress) => {
                const tileProgress = Math.max(0, Math.min(1, progress.progress));
                const overallTileProgress = (tileIndex + tileProgress) / totalTiles;
                const overall =
                  STILL_RENDER_PROGRESS_START +
                  overallTileProgress * (STILL_RENDER_PROGRESS_END - STILL_RENDER_PROGRESS_START);
                updateProgress(
                  overall,
                  0,
                  1,
                  `Rendering still tile ${tileIndex + 1}/${totalTiles} (${progress.subframe}/${progress.totalSubframes} subframes)`
                );
              },
              timeSeconds: 0
            });

            const tileImage = exportRenderer.captureDisplayImageData();
            ctx2d.putImageData(tileImage, x, topY);
            await yieldToUiFrames();
          }
          exportRenderer.clearCameraRayViewportOverride();
          updateProgress(STILL_ENCODE_PROGRESS, 0, 1, "Encoding PNG...");
          await yieldToUiFrames();
          pngBlob = await canvasToPngBlobLocal(outputCanvas);
        } else {
          exportRenderer.clearCameraRayViewportOverride();
          await exportRenderer.renderStill({
            width: dialogSnapshot.width,
            height: dialogSnapshot.height,
            subframes,
            signal: abortController.signal,
            onProgress: (progress) => {
              const renderProgress = Math.max(0, Math.min(1, progress.progress));
              const overall =
                STILL_RENDER_PROGRESS_START +
                renderProgress * (STILL_RENDER_PROGRESS_END - STILL_RENDER_PROGRESS_START);
              updateProgress(
                overall,
                0,
                1,
                `Rendering still (${progress.subframe}/${progress.totalSubframes} subframes)`
              );
            },
            timeSeconds: 0
          });
          if (abortController.signal.aborted) {
            throw createExportAbortErrorLocal();
          }
          updateProgress(STILL_READBACK_PROGRESS, 0, 1, "Reading pixels...");
          await yieldToUiFrames();
          const outputImage = exportRenderer.captureDisplayImageData();
          updateProgress(STILL_ENCODE_PROGRESS, 0, 1, "Encoding PNG...");
          await yieldToUiFrames();
          const outputCanvas = document.createElement("canvas");
          outputCanvas.width = outputImage.width;
          outputCanvas.height = outputImage.height;
          const ctx2d = outputCanvas.getContext("2d");
          if (ctx2d === null) {
            throw new Error("2D canvas context is unavailable for PNG export.");
          }
          ctx2d.putImageData(outputImage, 0, 0);
          pngBlob = await canvasToPngBlobLocal(outputCanvas);
        }
        if (abortController.signal.aborted) {
          throw createExportAbortErrorLocal();
        }

        updateProgress(STILL_DOWNLOAD_PREP_PROGRESS, 0, 1, "Preparing download...");
        await yieldToUiFrames();

        const sessionPayload = buildSettingsClipboardPayload({
          selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
          integratorId: activeIntegratorId,
          integratorOptions: activeIntegratorOptions,
          renderSettings,
          uniformValues,
          camera: cameraState,
          slicePlaneLockFrame,
          systemDefinition: {
            source: sourceDraft,
            treePath: selectedSystemTreePath,
            sourcePath: selectedSystemSourcePath,
            selectedSystemKey
          }
        });
        const sessionJson = serializeSettingsClipboardPayload(sessionPayload);
        updateProgress(STILL_METADATA_PROGRESS, 0, 1, "Embedding session metadata...");
        await yieldToUiFrames();
        const pngBytes = await blobToUint8Array(pngBlob);
        const embeddedPngBytes = embedSessionJsonInPng(pngBytes, sessionJson);
        const embeddedPngBuffer = new ArrayBuffer(embeddedPngBytes.byteLength);
        new Uint8Array(embeddedPngBuffer).set(embeddedPngBytes);
        const embeddedPngBlob = new Blob([embeddedPngBuffer], { type: "image/png" });

        downloadBlob(
          embeddedPngBlob,
          `${systemStem}_${dialogSnapshot.width}x${dialogSnapshot.height}.png`
        );
        updateProgress(1, 0, 1, "Still exported.");
        updateExportDialogState({ statusMessage: "Still exported as PNG." });
        pushToast("Still export complete.");
        await yieldToUiFrames(2);
        return;
      }

      const totalFrames = Math.max(1, dialogSnapshot.frameCount);
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        if (abortController.signal.aborted) {
          throw new Error("Export cancelled.");
        }

        const interpolated = buildInterpolatedExportState({
          frameIndex,
          frameCount: totalFrames,
          interpolation: dialogSnapshot.interpolation,
          uniformDefinitions: parseResult.uniforms,
          startUniformValues: exportStartPresetState.uniformValues,
          endUniformValues: exportEndPresetState.uniformValues,
          startCamera: exportStartPresetState.camera,
          endCamera: exportEndPresetState.camera
        });

        exportRenderer.updateIntegratorOptions(activeIntegratorOptions);
        exportRenderer.updateUniformValues(interpolated.uniformValues);
        exportRenderer.setCamera(interpolated.camera);

        const pngBlob = await exportRenderer.renderStillToPngBlob({
          width: dialogSnapshot.width,
          height: dialogSnapshot.height,
          subframes: Math.max(1, dialogSnapshot.subframes),
          signal: abortController.signal,
          onProgress: (progress) => {
            const perFrame = 1 / totalFrames;
            const overall = frameIndex * perFrame + progress.progress * perFrame;
            const easedPreview = applyInterpolationMode(dialogSnapshot.interpolation, frameIndex / Math.max(totalFrames - 1, 1));
            updateProgress(
              overall,
              frameIndex,
              totalFrames,
              `Rendering frame ${frameIndex + 1}/${totalFrames} (t=${easedPreview.toFixed(3)})`
            );
          },
          timeSeconds: 0
        });

        entries.push({
          name: makeAnimationFrameFileName(frameIndex, totalFrames),
          data: await blobToUint8Array(pngBlob)
        });
        await yieldToUiFrames();
      }

      updateProgress(0.995, totalFrames - 1, totalFrames, "Building ZIP...");
      await yieldToUiFrames();
      const zipBlob = buildZipStoreBlob(entries);
      downloadBlob(zipBlob, `${systemStem}_${dialogSnapshot.width}x${dialogSnapshot.height}_${totalFrames}f.zip`);
      updateProgress(1, totalFrames - 1, totalFrames, "Animation ZIP exported.");
      updateExportDialogState({ statusMessage: "Animation exported as ZIP of PNG frames." });
      pushToast(`Animation export complete (${totalFrames} frames).`);
      await yieldToUiFrames(2);
    } catch (error) {
      if (isAbortError(error) || (error instanceof Error && error.message === "Export cancelled.")) {
        updateExportDialogState({ statusMessage: "Export cancelled." });
        pushToast("Export cancelled.");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        updateExportDialogState({ statusMessage: `Export failed: ${message}` });
        pushToast(`Export failed: ${message}`, "error");
        console.error(`[app] Export failed for '${selectedSystemKey}': ${message}`);
      }
    } finally {
      exportAbortControllerRef.current = null;
      setExportProgressState(null);
      exportRenderer?.destroy();
    }
  };

  const onAppendPresetToDefinition = (): void => {
    setSettingsCopyActionsOpen(false);

    if (parseResult === null) {
      pushToast("Cannot append preset: compile a system first.", "error");
      return;
    }

    try {
      const presetName = makeAutoPresetName(
        parseResult.presets.map((preset) => preset.name),
        activePresetBySystem[selectedSystemKey] ?? null
      );
      const presetBlock = buildFragmentariumPresetBlock({
        name: presetName,
        uniforms: parseResult.uniforms,
        values: uniformValues
      });
      const nextSource = appendPresetBlockToSource(sourceDraft, presetBlock);

      setEditorSourceBySystem((prev) => ({
        ...prev,
        [selectedSystemKey]: nextSource
      }));
      pushToast(`Preset '${presetName}' appended. Build (F5) to refresh presets.`);
      console.info(`[app] Appended preset '${presetName}' to '${selectedSystemKey}'.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Append preset failed: ${message}`, "error");
      console.error(`[app] Failed to append preset for '${selectedSystemKey}': ${message}`);
    }
  };

  const onCopySettingsToClipboard = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard API writeText is unavailable in this browser context.");
      }

      const payload = buildSettingsClipboardPayload({
        selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
        integratorId: activeIntegratorId,
        integratorOptions: activeIntegratorOptions,
        renderSettings,
        uniformValues,
        camera: cameraState,
        slicePlaneLockFrame,
        systemDefinition: {
          source: sourceDraft,
          treePath: selectedSystemTreePath,
          sourcePath: selectedSystemSourcePath,
          selectedSystemKey
        }
      });

      await navigator.clipboard.writeText(serializeSettingsClipboardPayload(payload));
      pushToast("Session JSON copied to clipboard.");
      console.info(`[app] Copied session JSON for '${selectedSystemKey}' to clipboard.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Copy failed: ${message}`, "error");
      console.error(`[app] Failed to copy settings: ${message}`);
    }
  };

  const applySettingsClipboardPayloadToSystem = (
    payload: SettingsClipboardPayload,
    sourceLabel: "clipboard" | "png",
    targetEntryKey: string
  ): void => {
    let targetParseResult = parsedBySystem[targetEntryKey] ?? null;

    if (payload.systemDefinition !== undefined) {
      const incomingSource = payload.systemDefinition.source;
      setEditorSourceBySystem((prev) => ({
        ...prev,
        [targetEntryKey]: incomingSource
      }));

      try {
        const parsedIncoming = parseFragmentSource({
          source: incomingSource,
          sourceName: getSourceName(targetEntryKey),
          includeMap: SYSTEM_INCLUDE_MAP
        });
        targetParseResult = parsedIncoming;
        setParsedBySystem((prev) => ({
          ...prev,
          [targetEntryKey]: parsedIncoming
        }));
        setCompileError(null);
        console.info(`[app] Applied embedded system definition from ${sourceLabel} into '${targetEntryKey}'.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setCompileError(message);
        throw new Error(`Embedded system definition failed to compile: ${message}`);
      }
    }

    const nextIntegratorId = normalizeIntegratorId(payload.integratorId);
    const hasIntegrator = INTEGRATORS.some((entry) => entry.id === nextIntegratorId);
    if (!hasIntegrator) {
      throw new Error(`${sourceLabel.toUpperCase()} payload references unknown integrator '${payload.integratorId}'.`);
    }
    setActiveIntegratorId(nextIntegratorId);

    const nextIntegratorOptions = coerceIntegratorOptionsForId(nextIntegratorId, payload.integratorOptions);
    setIntegratorOptionsById((prev) => ({
      ...prev,
      [nextIntegratorId]: nextIntegratorOptions
    }));

    setRenderSettings(coerceRenderSettings(payload.renderSettings));
    setSlicePlaneLockFrameBySystem((prev) => ({
      ...prev,
      [targetEntryKey]:
        payload.slicePlaneLockFrame === undefined || payload.slicePlaneLockFrame === null
          ? null
          : cloneSlicePlaneLockFrame(payload.slicePlaneLockFrame)
    }));

    if (targetParseResult !== null) {
      const nextUniformValues = coerceUniformValues(targetParseResult.uniforms, payload.uniformValues);
      const nextCamera = deriveCameraFromUniformValues(targetParseResult.uniforms, nextUniformValues, payload.camera);

      setUniformValuesBySystem((prev) => ({
        ...prev,
        [targetEntryKey]: nextUniformValues
      }));
      setCameraBySystem((prev) => ({
        ...prev,
        [targetEntryKey]: nextCamera
      }));

      if (payload.selectedPresetName !== null) {
        const presetName = payload.selectedPresetName;
        const presetExists = targetParseResult.presets.some((preset) => preset.name === presetName);
        if (presetExists) {
          setActivePresetBySystem((prev) => ({
            ...prev,
            [targetEntryKey]: presetName
          }));
        }
      }
    } else {
      setUniformValuesBySystem((prev) => ({
        ...prev,
        [targetEntryKey]: payload.uniformValues
      }));
      setCameraBySystem((prev) => ({
        ...prev,
        [targetEntryKey]: payload.camera
      }));
    }

    if (selectedSystemKey !== targetEntryKey) {
      setSelectedSystemKey(targetEntryKey);
    }
  };

  const applySettingsClipboardPayloadToCurrentSystem = (
    payload: SettingsClipboardPayload,
    sourceLabel: "clipboard" | "png"
  ): void => {
    applySettingsClipboardPayloadToSystem(payload, sourceLabel, selectedSystemKey);
  };

  const onPasteSettingsFromClipboard = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || typeof navigator.clipboard.readText !== "function") {
        throw new Error("Clipboard API readText is unavailable in this browser context.");
      }

      const raw = await navigator.clipboard.readText();
      const payload = parseSettingsClipboardPayload(raw);
      applySettingsClipboardPayloadToCurrentSystem(payload, "clipboard");

      pushToast("Session JSON pasted from clipboard.");
      console.info(`[app] Pasted session JSON into '${selectedSystemKey}'.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Paste failed: ${message}`, "error");
      console.error(`[app] Failed to paste settings: ${message}`);
    }
  };

  const shouldWarnBeforeReplacingCurrentSession = (): boolean => {
    let shouldWarn = hasSourceChanges;
    if (selectedLocalPath !== null) {
      shouldWarn = hasSessionChanges;
    }
    return shouldWarn;
  };

  const completeSessionPngImport = (payload: SettingsClipboardPayload, fileName: string): void => {
    const targetEntryKey =
      selectedLocalPath !== null
        ? (resolvePreferredPresetEntryKeyFromPayload(payload) ?? getDefaultPresetEntryKey())
        : selectedSystemKey;
    applySettingsClipboardPayloadToSystem(payload, "png", targetEntryKey);
    pushToast(`Session loaded from PNG: ${fileName}`);
    console.info(`[app] Loaded session from PNG '${fileName}' into '${targetEntryKey}'.`);
  };

  const queueOrApplySessionPngImport = (payload: SettingsClipboardPayload, fileName: string): void => {
    if (shouldWarnBeforeReplacingCurrentSession()) {
      setPendingSessionPngImport({ fileName, payload });
      return;
    }
    completeSessionPngImport(payload, fileName);
  };

  const importSessionFromPngFile = async (file: File): Promise<void> => {
    if (!isPngFile(file)) {
      throw new Error(`'${file.name}' is not a PNG file.`);
    }

    const pngBytes = await blobToUint8Array(file);
    const embeddedSessionJson = extractSessionJsonFromPng(pngBytes);
    if (embeddedSessionJson === null) {
      throw new Error(`PNG '${file.name}' does not contain embedded Fragmentarium Web session data.`);
    }

    const payload = parseSettingsClipboardPayload(embeddedSessionJson);
    queueOrApplySessionPngImport(payload, file.name);
  };

  const onDownloadSessionPng = async (): Promise<void> => {
    setDefinitionActionsOpen(false);

    if (sessionPngExportInProgress) {
      return;
    }
    if (parseResult === null) {
      pushToast("Compile a system before exporting Session PNG.", "error");
      return;
    }

    const payload = buildSettingsClipboardPayload({
      selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
      integratorId: activeIntegratorId,
      integratorOptions: activeIntegratorOptions,
      renderSettings,
      uniformValues,
      camera: cameraState,
      slicePlaneLockFrame,
      systemDefinition: {
        source: sourceDraft,
        treePath: selectedSystemTreePath,
        sourcePath: selectedSystemSourcePath,
        selectedSystemKey
      }
    });
    const sessionJson = serializeSettingsClipboardPayload(payload);

    const aspectWidth = Math.max(1, Math.round(status.resolution[0]));
    const aspectHeight = Math.max(1, Math.round(status.resolution[1]));
    const width = SESSION_PNG_PREVIEW_WIDTH;
    const height = Math.max(1, Math.round((SESSION_PNG_PREVIEW_WIDTH * aspectHeight) / aspectWidth));

    console.info(
      `[app] Exporting session PNG preview for '${selectedSystemKey}' at ${width}x${height} (${SESSION_PNG_PREVIEW_SUBFRAMES} subframes).`
    );
    setSessionPngExportInProgress(true);

    const offscreenCanvas = document.createElement("canvas");
    let exportRenderer: FragmentRenderer | null = null;
    try {
      await yieldToUiFrames(1);

      exportRenderer = new FragmentRenderer(offscreenCanvas, {
        onStatus: () => {
          // no-op for session PNG preview export
        }
      });
      exportRenderer.setRenderSettings({
        ...renderSettings,
        interactionResolutionScale: 1,
        tileCount: 1,
        tilesPerFrame: 1,
        maxSubframes: SESSION_PNG_PREVIEW_SUBFRAMES
      });
      exportRenderer.setScene({
        geometrySource: parseResult.shaderSource,
        geometryLineMap: parseResult.shaderLineMap,
        uniformDefinitions: parseResult.uniforms,
        uniformValues,
        integrator: activeIntegrator,
        integratorOptions: activeIntegratorOptions
      });
      exportRenderer.updateIntegratorOptions(activeIntegratorOptions);
      exportRenderer.updateUniformValues(uniformValues);
      exportRenderer.updateSlicePlaneLockFrame(slicePlaneLockFrame);
      exportRenderer.setCamera(cameraState);

      const previewPngBlob = await exportRenderer.renderStillToPngBlob({
        width,
        height,
        subframes: SESSION_PNG_PREVIEW_SUBFRAMES
      });
      const previewPngBytes = await blobToUint8Array(previewPngBlob);
      const embeddedPngBytes = embedSessionJsonInPng(previewPngBytes, sessionJson);
      const embeddedPngBuffer = new ArrayBuffer(embeddedPngBytes.byteLength);
      new Uint8Array(embeddedPngBuffer).set(embeddedPngBytes);
      const embeddedPngBlob = new Blob([embeddedPngBuffer], { type: "image/png" });
      const fileName = `${sanitizeFileStem(selectedSystemTreePath)}_session.png`;
      downloadBlob(embeddedPngBlob, fileName);

      pushToast("Session PNG exported.");
      console.info(`[app] Session PNG exported: ${fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Session PNG export failed: ${message}`, "error");
      console.error(`[app] Session PNG export failed for '${selectedSystemKey}': ${message}`);
    } finally {
      exportRenderer?.destroy();
      setSessionPngExportInProgress(false);
    }
  };

  const onOpenSessionFromGallery = (item: SessionGalleryItem): void => {
    if (item.sourceKind === "local") {
      if (item.localPath === undefined) {
        pushToast("Local session entry is missing a local path.", "error");
        return;
      }
      setSessionGalleryOpen(false);
      onSwitchSystem(makeLocalEntryKey(item.localPath));
      return;
    }

    if (item.sourceKind === "github") {
      const remotePngUrl = item.remotePngUrl;
      if (remotePngUrl === undefined) {
        pushToast("GitHub gallery entry is missing a PNG URL.", "error");
        return;
      }
      void (async () => {
        setBlockingTask({
          title: "Loading Remote Session PNG",
          message: `Fetching '${item.path}'...`,
          detail: remotePngUrl,
          progress: null
        });
        try {
          const response = await fetch(remotePngUrl, { method: "GET" });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }
          const pngBytes = new Uint8Array(await response.arrayBuffer());
          const payload = parseEmbeddedSessionPayloadFromPngBytes(pngBytes);
          const fileName = item.path.split("/").pop() ?? item.path;
          setSessionGalleryOpen(false);
          queueOrApplySessionPngImport(payload, fileName);
          console.info(`[app] Loaded remote gallery PNG session '${item.path}' from '${remotePngUrl}'.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          pushToast(`Remote session PNG load failed: ${message}`, "error");
          console.error(`[app] Failed to load remote gallery PNG '${item.path}': ${message}`);
        } finally {
          setBlockingTask(null);
        }
      })();
      return;
    }
  };

  const onDeleteSessionFromGallery = (localPath: string): void => {
    setDeleteLocalDialogPath(localPath);
  };

  const onExportAllSessionsZip = async (): Promise<void> => {
    const entriesByPath = Object.entries(localSessionSnapshotsByPath).sort(([a], [b]) => a.localeCompare(b));
    if (entriesByPath.length === 0) {
      pushToast("No local session snapshots to export.", "error");
      return;
    }

    setBlockingTask({
      title: "Exporting Session Gallery",
      message: "Collecting snapshot PNGs...",
      detail: `0/${entriesByPath.length}`,
      progress: 0
    });

    try {
      await yieldToUiFrames(1);
      const zipEntries: Array<{ name: string; data: Uint8Array; modifiedAt?: Date }> = [];
      for (let index = 0; index < entriesByPath.length; index += 1) {
        const [path, snapshot] = entriesByPath[index];
        setBlockingTask((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                message: `Packing '${path}'...`,
                detail: `${index + 1}/${entriesByPath.length}`,
                progress: (index / entriesByPath.length) * 0.8
              }
        );
        zipEntries.push({
          name: makeLocalSessionSnapshotZipEntryName(path),
          data: await blobToUint8Array(snapshot.pngBlob),
          modifiedAt: new Date(snapshot.updatedAtMs)
        });
      }

      setBlockingTask((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              message: "Building ZIP archive...",
              detail: `${entriesByPath.length} session snapshot PNGs`,
              progress: 0.92
            }
      );
      const zipBlob = buildZipStoreBlob(zipEntries);
      const fileName = `fragmentarium-web-session-gallery-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.zip`;
      downloadBlob(zipBlob, fileName);
      setBlockingTask((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              message: "Session gallery ZIP exported.",
              detail: fileName,
              progress: 1
            }
      );
      await yieldToUiFrames(1);
      pushToast(`Exported ${entriesByPath.length} session snapshot${entriesByPath.length === 1 ? "" : "s"} as ZIP.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Session gallery export failed: ${message}`, "error");
      console.error(`[app] Session gallery ZIP export failed: ${message}`);
    } finally {
      setBlockingTask(null);
    }
  };

  const onImportSessionsZip = async (file: File): Promise<void> => {
    const lowerName = file.name.toLowerCase();
    if (!(file.type === "application/zip" || lowerName.endsWith(".zip"))) {
      pushToast(`'${file.name}' is not a ZIP file.`, "error");
      return;
    }

    setBlockingTask({
      title: "Importing Session Gallery ZIP",
      message: `Reading '${file.name}'...`,
      detail: null,
      progress: 0
    });

    try {
      await yieldToUiFrames(1);
      const zipBytes = await blobToUint8Array(file);
      setBlockingTask((prev) =>
        prev === null ? prev : { ...prev, message: "Parsing ZIP entries...", progress: 0.08 }
      );
      const parsedEntries = parseZipStore(zipBytes).filter((entry) => !entry.name.endsWith("/"));
      if (parsedEntries.length === 0) {
        throw new Error("ZIP does not contain any files.");
      }

      const decodedSnapshots: DecodedLocalSessionSnapshot[] = [];
      const recordsToWrite: SessionSnapshotRecord[] = [];
      const occupiedPaths = new Set<string>(Object.keys(localSessionSnapshotsByPath));
      let renamedCount = 0;
      for (let index = 0; index < parsedEntries.length; index += 1) {
        const entry = parsedEntries[index];
        setBlockingTask((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                message: `Validating '${entry.name}'...`,
                detail: `${index + 1}/${parsedEntries.length}`,
                progress: 0.1 + (index / parsedEntries.length) * 0.35
              }
        );
        const parsedLocalPath = parseLocalSessionSnapshotZipEntryName(entry.name);
        const localPath = makeUniqueSessionPath(parsedLocalPath, occupiedPaths);
        if (localPath !== parsedLocalPath) {
          renamedCount += 1;
        }
        occupiedPaths.add(localPath);
        const payload = parseEmbeddedSessionPayloadFromPngBytes(entry.data);
        const source = requireEmbeddedSystemSource(payload, `ZIP entry '${entry.name}'`);
        const pngBlob = uint8ArrayToBlob(entry.data, "image/png");
        const updatedAtMs = entry.modifiedAt?.getTime() ?? Date.now();
        if (!Number.isFinite(updatedAtMs)) {
          throw new Error(`ZIP entry '${entry.name}' has invalid modified timestamp.`);
        }
        const createdAtMs = updatedAtMs;

        decodedSnapshots.push({
          path: localPath,
          payload,
          source,
          snapshotPngBlob: pngBlob,
          createdAtMs,
          updatedAtMs
        });
        recordsToWrite.push({
          path: localPath,
          pngBlob,
          createdAtMs,
          updatedAtMs
        });
      }

      for (let index = 0; index < recordsToWrite.length; index += 1) {
        const record = recordsToWrite[index];
        setBlockingTask((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                message: `Writing '${record.path}' to local database...`,
                detail: `${index + 1}/${recordsToWrite.length}`,
                progress: 0.5 + (index / recordsToWrite.length) * 0.45
              }
        );
        await putSessionSnapshotRecord(record);
      }

      upsertDecodedLocalSessionSnapshots(decodedSnapshots);
      setBlockingTask((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              message: `Imported ${decodedSnapshots.length} session snapshot${decodedSnapshots.length === 1 ? "" : "s"}.`,
              detail: file.name,
              progress: 1
            }
      );
      await yieldToUiFrames(1);
      pushToast(
        `Imported ${decodedSnapshots.length} session snapshot${decodedSnapshots.length === 1 ? "" : "s"} from ZIP${
          renamedCount > 0 ? ` (${renamedCount} renamed)` : ""
        }.`
      );
      console.info(`[app] Imported ${decodedSnapshots.length} local session snapshot(s) from ZIP '${file.name}'.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Session gallery import failed: ${message}`, "error");
      console.error(`[app] Session gallery ZIP import failed: ${message}`);
    } finally {
      setBlockingTask(null);
    }
  };

  const onAppDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!dropImportOverlayVisible) {
        setDropImportOverlayVisible(true);
      }
    }
  };

  const onAppDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setDropImportOverlayVisible(true);
  };

  const onAppDragLeave = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setDropImportOverlayVisible(false);
    }
  };

  const onAppDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    fileDragDepthRef.current = 0;
    setDropImportOverlayVisible(false);

    if (isBlockingTaskActive) {
      pushToast("Finish the current task before importing.", "error");
      return;
    }

    if (pendingSwitchEntryKey !== null || pendingSessionPngImport !== null) {
      pushToast("Finish the pending discard confirmation before importing a Session PNG.", "error");
      return;
    }

    const files = [...event.dataTransfer.files];
    if (files.length !== 1) {
      pushToast("Drop exactly one PNG file to import a session.", "error");
      return;
    }

    void (async () => {
      try {
        const file = files[0];
        const lowerName = file.name.toLowerCase();
        if (isPngFile(file)) {
          await importSessionFromPngFile(file);
          return;
        }
        if (file.type === "application/zip" || lowerName.endsWith(".zip")) {
          await onImportSessionsZip(file);
          return;
        }
        throw new Error(`'${file.name}' is not a PNG or ZIP file.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushToast(`Import failed: ${message}`, "error");
        console.error(`[app] File import failed: ${message}`);
      }
    })();
  };

  const onCopyErrorToClipboard = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard API writeText is unavailable in this browser context.");
      }

      const payloadLines = [
        "Fragmentarium Web Error Report",
        `System: ${selectedSystemKey}`,
        `Tree path: ${selectedSystemTreePath}`,
        `Source path: ${selectedSystemSourcePath}`,
        `Integrator: ${activeIntegrator.name} (${activeIntegrator.id})`,
        `Preset: ${activePresetBySystem[selectedSystemKey] ?? "None"}`,
        "",
        compileError !== null ? `Compile error:\n${compileError}` : null,
        shaderError !== null ? `Shader error:\n${shaderError}` : null,
        shaderErrorDetails !== null && mappedShaderDiagnostics.length > 0
          ? `Mapped diagnostics:\n${mappedShaderDiagnostics
              .map((entry) => `${entry.mappedSource!.path}:${entry.mappedSource!.line}: ${entry.message}`)
              .join("\n")}`
          : null
      ].filter((entry): entry is string => entry !== null);

      await navigator.clipboard.writeText(payloadLines.join("\n"));
      setErrorClipboardStatus("Error details copied.");
      console.info(`[app] Copied error details for '${selectedSystemTreePath}' to clipboard.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorClipboardStatus(`Copy failed: ${message}`);
      console.error(`[app] Failed to copy error details: ${message}`);
    }
  };

  const performSwitchSystem = (entryKey: string): void => {
    const nextLocalPath = parseLocalPathFromKey(entryKey);
    if (nextLocalPath !== null) {
      const payload = localSessionPayloadsByPath[nextLocalPath];
      if (payload !== undefined) {
        try {
          const source = payload.systemDefinition?.source;
          if (typeof source !== "string" || source.length === 0) {
            throw new Error("Session is missing embedded system source.");
          }
          const parsed = parseFragmentSource({
            source,
            sourceName: getSourceName(entryKey),
            includeMap: SYSTEM_INCLUDE_MAP
          });
          const nextUniformValues = coerceUniformValues(parsed.uniforms, payload.uniformValues);
          const nextCamera = deriveCameraFromUniformValues(parsed.uniforms, nextUniformValues, payload.camera);
          const nextIntegratorId = normalizeIntegratorId(payload.integratorId);
          const nextIntegratorOptions = coerceIntegratorOptionsForId(nextIntegratorId, payload.integratorOptions);

          setEditorSourceBySystem((prev) => ({ ...prev, [entryKey]: source }));
          setParsedBySystem((prev) => ({ ...prev, [entryKey]: parsed }));
          setUniformValuesBySystem((prev) => ({ ...prev, [entryKey]: nextUniformValues }));
          setCameraBySystem((prev) => ({ ...prev, [entryKey]: nextCamera }));
          setActivePresetBySystem((prev) => {
            const next = { ...prev };
            const presetName = payload.selectedPresetName;
            if (presetName !== null && parsed.presets.some((preset) => preset.name === presetName)) {
              next[entryKey] = presetName;
            } else {
              delete next[entryKey];
            }
            return next;
          });
          setActiveIntegratorId(nextIntegratorId);
          setIntegratorOptionsById((prev) => ({
            ...prev,
            [nextIntegratorId]: nextIntegratorOptions
          }));
          setRenderSettings(coerceRenderSettings(payload.renderSettings));
          setSlicePlaneLockFrameBySystem((prev) => ({
            ...prev,
            [entryKey]:
              payload.slicePlaneLockFrame === undefined || payload.slicePlaneLockFrame === null
                ? null
                : cloneSlicePlaneLockFrame(payload.slicePlaneLockFrame)
          }));
          setCompileError(null);
          setSelectedSystemKey(entryKey);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setCompileError(message);
          pushToast(`Failed to load session: ${message}`, "error");
          console.error(`[app] Failed to load session '${nextLocalPath}': ${message}`);
          return;
        }
      }
    }

    setSelectedSystemKey(entryKey);
    if (parsedBySystem[entryKey] === undefined) {
      compileSystem(entryKey);
    }
  };

  const onSwitchSystem = (entryKey: string): void => {
    if (entryKey === selectedSystemKey) {
      return;
    }

    let shouldWarn = hasSourceChanges;
    if (selectedLocalPath !== null) {
      shouldWarn = hasSessionChanges;
    }

    if (shouldWarn) {
      setPendingSwitchEntryKey(entryKey);
      return;
    }

    performSwitchSystem(entryKey);
  };

  const onCancelDiscardSwitchDialog = (): void => {
    setPendingSwitchEntryKey(null);
    setPendingSessionPngImport(null);
  };

  const onConfirmDiscardSwitchDialog = (): void => {
    if (pendingSessionPngImport !== null) {
      const pending = pendingSessionPngImport;
      setPendingSessionPngImport(null);
      try {
        completeSessionPngImport(pending.payload, pending.fileName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushToast(`Session PNG import failed: ${message}`, "error");
        console.error(`[app] Session PNG import failed after discard confirm: ${message}`);
      }
      return;
    }
    if (pendingSwitchEntryKey === null) {
      return;
    }
    const nextEntryKey = pendingSwitchEntryKey;
    setPendingSwitchEntryKey(null);
    performSwitchSystem(nextEntryKey);
  };

  const saveSourceToLocalPath = async (normalizedPath: string): Promise<void> => {
    if (parseResult === null) {
      throw new Error("Compile the current system before saving a local session snapshot.");
    }

    const targetEntryKey = makeLocalEntryKey(normalizedPath);
    const payload = buildSettingsClipboardPayload({
      selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
      integratorId: activeIntegratorId,
      integratorOptions: activeIntegratorOptions,
      renderSettings,
      uniformValues,
      camera: cameraState,
      slicePlaneLockFrame,
      systemDefinition: {
        source: sourceDraft,
        treePath: selectedSystemTreePath,
        sourcePath: selectedSystemSourcePath,
        selectedSystemKey
      }
    });
    const sessionJson = serializeSettingsClipboardPayload(payload);

    const aspectWidth = Math.max(1, Math.round(status.resolution[0]));
    const aspectHeight = Math.max(1, Math.round(status.resolution[1]));
    const width = LOCAL_SESSION_SNAPSHOT_PREVIEW_WIDTH;
    const height = Math.max(1, Math.round((LOCAL_SESSION_SNAPSHOT_PREVIEW_WIDTH * aspectHeight) / aspectWidth));
    const updatedAtMs = Date.now();
    const createdAtMs = localSessionSnapshotsByPath[normalizedPath]?.createdAtMs ?? updatedAtMs;

    console.info(
      `[app] Saving session snapshot '${normalizedPath}' at ${width}x${height} (${LOCAL_SESSION_SNAPSHOT_PREVIEW_SUBFRAMES} subframes).`
    );

    setBlockingTask({
      title: "Saving Session Snapshot",
      message: `Rendering preview for '${normalizedPath}'...`,
      detail: `${width}x${height}, ${LOCAL_SESSION_SNAPSHOT_PREVIEW_SUBFRAMES} subframes`,
      progress: 0
    });

    const offscreenCanvas = document.createElement("canvas");
    let exportRenderer: FragmentRenderer | null = null;
    let embeddedPngBlob: Blob | null = null;
    try {
      await yieldToUiFrames(1);

      exportRenderer = new FragmentRenderer(offscreenCanvas, {
        onStatus: (nextStatus) => {
          const targetSubframes = Math.max(1, LOCAL_SESSION_SNAPSHOT_PREVIEW_SUBFRAMES);
          const subframeProgress = Math.max(0, Math.min(1, nextStatus.subframe / targetSubframes));
          setBlockingTask((prev) =>
            prev === null
              ? prev
              : {
                  ...prev,
                  message: `Rendering preview for '${normalizedPath}'...`,
                  detail: `Subframe ${Math.min(nextStatus.subframe, targetSubframes)}/${targetSubframes}`,
                  progress: subframeProgress * 0.8
                }
          );
        }
      });
      exportRenderer.setRenderSettings({
        ...renderSettings,
        interactionResolutionScale: 1,
        tileCount: 1,
        tilesPerFrame: 1,
        maxSubframes: LOCAL_SESSION_SNAPSHOT_PREVIEW_SUBFRAMES
      });
      exportRenderer.setScene({
        geometrySource: parseResult.shaderSource,
        geometryLineMap: parseResult.shaderLineMap,
        uniformDefinitions: parseResult.uniforms,
        uniformValues,
        integrator: activeIntegrator,
        integratorOptions: activeIntegratorOptions
      });
      exportRenderer.updateIntegratorOptions(activeIntegratorOptions);
      exportRenderer.updateUniformValues(uniformValues);
      exportRenderer.updateSlicePlaneLockFrame(slicePlaneLockFrame);
      exportRenderer.setCamera(cameraState);

      const previewPngBlob = await exportRenderer.renderStillToPngBlob({
        width,
        height,
        subframes: LOCAL_SESSION_SNAPSHOT_PREVIEW_SUBFRAMES
      });

      setBlockingTask((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              message: `Embedding session metadata for '${normalizedPath}'...`,
              detail: "Writing PNG iTXt metadata chunk",
              progress: 0.9
            }
      );
      const previewPngBytes = await blobToUint8Array(previewPngBlob);
      const embeddedPngBytes = embedSessionJsonInPng(previewPngBytes, sessionJson);
      embeddedPngBlob = uint8ArrayToBlob(embeddedPngBytes, "image/png");

      setBlockingTask((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              message: `Writing snapshot '${normalizedPath}' to local database...`,
              detail: "IndexedDB commit",
              progress: 0.96
            }
      );
      await putSessionSnapshotRecord({
        path: normalizedPath,
        pngBlob: embeddedPngBlob,
        createdAtMs,
        updatedAtMs
      });
    } finally {
      exportRenderer?.destroy();
    }

    if (embeddedPngBlob === null) {
      throw new Error("Session snapshot PNG generation failed.");
    }

    setLocalSessionPayloadsByPath((prev) => ({
      ...prev,
      [normalizedPath]: payload
    }));
    setLocalSystemsByPath((prev) => ({
      ...prev,
      [normalizedPath]: sourceDraft
    }));
    setEditorSourceBySystem((prev) => ({
      ...prev,
      [targetEntryKey]: sourceDraft
    }));
    setLocalSessionSnapshotsByPath((prev) => ({
      ...prev,
      [normalizedPath]: {
        pngBlob: embeddedPngBlob as Blob,
        createdAtMs,
        updatedAtMs
      }
    }));
    setUniformValuesBySystem((prev) => {
      const current = prev[selectedSystemKey];
      if (current === undefined) {
        return prev;
      }
      return {
        ...prev,
        [targetEntryKey]: { ...current }
      };
    });
    setCameraBySystem((prev) => {
      const current = prev[selectedSystemKey];
      if (current === undefined) {
        return prev;
      }
      return {
        ...prev,
        [targetEntryKey]: {
          eye: [...current.eye],
          target: [...current.target],
          up: [...current.up],
          fov: current.fov
        }
      };
    });
    setActivePresetBySystem((prev) => {
      const current = prev[selectedSystemKey];
      if (current === undefined) {
        return prev;
      }
      return {
        ...prev,
        [targetEntryKey]: current
      };
    });
    setSlicePlaneLockFrameBySystem((prev) => ({
      ...prev,
      [targetEntryKey]: slicePlaneLockFrame === null ? null : cloneSlicePlaneLockFrame(slicePlaneLockFrame)
    }));
    setSelectedSystemKey(targetEntryKey);
    setBlockingTask({
      title: "Saving Session Snapshot",
      message: `Saved '${normalizedPath}'.`,
      detail: "Finalizing UI state...",
      progress: 1
    });
    await yieldToUiFrames(1);
    setBlockingTask(null);
    pushToast(`Session saved: ${normalizedPath}`);
  };

  const deleteLocalSystemByPath = (localPath: string): void => {
    const entryKey = makeLocalEntryKey(localPath);

    setLocalSessionPayloadsByPath((prev) => {
      const next = { ...prev };
      delete next[localPath];
      return next;
    });
    setLocalSessionSnapshotsByPath((prev) => {
      const next = { ...prev };
      delete next[localPath];
      return next;
    });
    setLocalSystemsByPath((prev) => {
      const next = { ...prev };
      delete next[localPath];
      return next;
    });
    setEditorSourceBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setParsedBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setUniformValuesBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setCameraBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setActivePresetBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setSlicePlaneLockFrameBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });

    if (selectedSystemKey === entryKey) {
      setSelectedSystemKey(getDefaultPresetEntryKey());
    }
  };

  const renameLocalSystemByPathInState = (fromPath: string, toPath: string): void => {
    if (fromPath === toPath) {
      return;
    }
    const fromEntryKey = makeLocalEntryKey(fromPath);
    const toEntryKey = makeLocalEntryKey(toPath);

    setLocalSessionPayloadsByPath((prev) => {
      if (prev[fromPath] === undefined) {
        return prev;
      }
      const next = { ...prev };
      next[toPath] = next[fromPath] as SettingsClipboardPayload;
      delete next[fromPath];
      return next;
    });
    setLocalSessionSnapshotsByPath((prev) => {
      if (prev[fromPath] === undefined) {
        return prev;
      }
      const next = { ...prev };
      next[toPath] = next[fromPath] as LocalSessionSnapshotState;
      delete next[fromPath];
      return next;
    });
    setLocalSystemsByPath((prev) => {
      if (prev[fromPath] === undefined) {
        return prev;
      }
      const next = { ...prev };
      next[toPath] = next[fromPath] as string;
      delete next[fromPath];
      return next;
    });
    setEditorSourceBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setParsedBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setUniformValuesBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setCameraBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setActivePresetBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setSlicePlaneLockFrameBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setActiveUniformGroupBySystem((prev) => renameRecordKey(prev, fromEntryKey, toEntryKey));
    setSelectedSystemKey((prev) => (prev === fromEntryKey ? toEntryKey : prev));
  };

  const onDeleteLocalSystem = (localPath: string): void => {
    setDeleteLocalDialogPath(localPath);
  };

  const onRenameSessionFromGallery = async (fromPath: string, requestedPath: string): Promise<void> => {
    const normalizedRequestedPath = normalizeLocalPath(requestedPath);
    if (normalizedRequestedPath === null) {
      throw new Error("Invalid session path. Please use a non-empty path like 'folder/name'.");
    }
    if (normalizedRequestedPath === fromPath) {
      return;
    }
    if (localSessionSnapshotsByPath[fromPath] === undefined) {
      throw new Error(`Session '${fromPath}' no longer exists.`);
    }
    if (localSessionSnapshotsByPath[normalizedRequestedPath] !== undefined) {
      throw new Error(`A session named '${normalizedRequestedPath}' already exists.`);
    }

    const snapshot = localSessionSnapshotsByPath[fromPath] as LocalSessionSnapshotState;
    const updatedAtMs = Date.now();

    setBlockingTask({
      title: "Renaming Session",
      message: `Renaming '${fromPath}' to '${normalizedRequestedPath}'...`,
      detail: "Updating local database",
      progress: null
    });

    try {
      await putSessionSnapshotRecord({
        path: normalizedRequestedPath,
        pngBlob: snapshot.pngBlob,
        createdAtMs: snapshot.createdAtMs,
        updatedAtMs
      });
      await deleteSessionSnapshotRecord(fromPath);

      renameLocalSystemByPathInState(fromPath, normalizedRequestedPath);
      setLocalSessionSnapshotsByPath((prev) => {
        const renamed = prev[normalizedRequestedPath];
        if (renamed === undefined) {
          return prev;
        }
        return {
          ...prev,
          [normalizedRequestedPath]: {
            ...renamed,
            updatedAtMs
          }
        };
      });
      pushToast(`Session renamed to '${normalizedRequestedPath}'.`);
      console.info(`[app] Renamed local session '${fromPath}' -> '${normalizedRequestedPath}'.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[app] Failed to rename local session '${fromPath}' -> '${normalizedRequestedPath}': ${message}`);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      setBlockingTask(null);
    }
  };

  const onConfirmDeleteLocalSystem = async (): Promise<void> => {
    if (deleteLocalDialogPath === null) {
      return;
    }
    const localPath = deleteLocalDialogPath;
    setBlockingTask({
      title: "Deleting Session",
      message: `Removing '${localPath}' from local database...`,
      detail: "IndexedDB delete",
      progress: null
    });
    try {
      await deleteSessionSnapshotRecord(localPath);
      deleteLocalSystemByPath(localPath);
      setBlockingTask(null);
      pushToast(`Session deleted: ${localPath}`);
    } catch (error) {
      setBlockingTask(null);
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Delete failed: ${message}`, "error");
      console.error(`[app] Failed to delete local session '${localPath}': ${message}`);
      return;
    }
    setDeleteLocalDialogPath(null);
  };

  const onSaveAsNewSession = (): void => {
    const occupiedPaths = Object.keys(localSessionSnapshotsByPath);
    const baseSuggestedName =
      selectedLocalPath !== null
        ? selectedLocalPath
        : selectedPresetSystem !== null
          ? `${selectedPresetSystem.id}/my-session`
          : "sessions/custom";
    const suggestedName = makeUniqueSessionPath(baseSuggestedName, occupiedPaths);
    setSaveLocalDialog({
      pathValue: suggestedName,
      errorMessage: null
    });
  };

  const onUpdateCurrentSession = async (): Promise<void> => {
    if (selectedLocalPath === null || !hasSessionChanges) {
      return;
    }

    try {
      await saveSourceToLocalPath(selectedLocalPath);
    } catch (error) {
      setBlockingTask(null);
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Session update failed: ${message}`, "error");
      console.error(`[app] Failed to update local session '${selectedLocalPath}': ${message}`);
    }
  };

  const onBeautifySource = (): void => {
    setDefinitionActionsOpen(false);
    const result = formatFragmentSource(sourceDraft);
    if (!result.changed) {
      pushToast("Definition already formatted.");
      return;
    }

    setEditorSourceBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: result.text
    }));
    pushToast("Definition beautified.");
  };

  const onCancelSaveLocalDialog = (): void => {
    setSaveLocalDialog(null);
  };

  const onConfirmSaveLocalDialog = async (): Promise<void> => {
    if (saveLocalDialog === null) {
      return;
    }

    const normalizedPath = normalizeLocalPath(saveLocalDialog.pathValue);
    if (normalizedPath === null) {
      setSaveLocalDialog((prev) => {
        if (prev === null) {
          return prev;
        }
        return {
          ...prev,
          errorMessage: "Invalid session path. Please use a non-empty path like 'folder/name'."
        };
      });
      return;
    }

    try {
      await saveSourceToLocalPath(normalizedPath);
      setSaveLocalDialog(null);
    } catch (error) {
      setBlockingTask(null);
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Session save failed: ${message}`, "error");
      console.error(`[app] Failed to save local session '${normalizedPath}': ${message}`);
    }
  };

  const onSwitchIntegrator = (integratorId: string): void => {
    setActiveIntegratorId(integratorId);
    setIntegratorOptionsById((prev) => {
      const targetBase = prev[integratorId] ?? getDefaultIntegratorOptions(integratorId);
      const transferred = transferSharedIntegratorOptions(
        activeIntegratorId,
        activeIntegratorOptions,
        integratorId,
        targetBase
      );
      return {
        ...prev,
        [integratorId]: transferred
      };
    });
  };

  const leftPane = (
    <div className="pane-content left-pane left-pane-content">
      <VerticalSplitLayout
        topHeight={leftSystemsPaneHeightPx}
        minTopHeight={MIN_LEFT_SECTION_HEIGHT}
        minBottomHeight={MIN_LEFT_SECTION_HEIGHT}
        onTopHeightChange={setLeftSystemsPaneHeightPx}
        top={
          <section className="section-block section-fill">
            <h2>Systems</h2>
            <SystemsTreeView
              nodes={systemsTreeNodes}
              activeEntryKey={selectedSystemKey}
              onSelect={onSwitchSystem}
              onDeleteLocal={onDeleteLocalSystem}
              localPreviewUrlByPath={localSessionPreviewUrlsByPath}
            />
          </section>
        }
        bottom={
          <section className="section-block section-fill">
            <div className="section-header-row definition-actions-toolbar">
              <div className="definition-actions-group definition-actions-group-main">
                <AppButton
                  variant="primary"
                  onClick={() => compileSystem(selectedSystemKey)}
                  disabled={isBlockingTaskActive}
                  title="Build (F5)"
                >
                  Build (F5)
                </AppButton>
              </div>
              <div className="definition-actions-group definition-actions-group-session">
                <AppButton
                  onClick={onSaveAsNewSession}
                  disabled={isBlockingTaskActive}
                  title="Save as New Session"
                >
                  Save New
                </AppButton>
                <AppButton
                  onClick={() => void onUpdateCurrentSession()}
                  disabled={!canUpdateCurrentSession || isBlockingTaskActive}
                  title={selectedLocalPath === null ? "Update Current Session (disabled on presets)" : "Update Current Session"}
                >
                  Update
                </AppButton>
                <div className="header-menu-anchor" ref={definitionActionsRef}>
                  <AppButton
                    variant="ghost"
                    className="header-menu-trigger definition-actions-more"
                    aria-label="Definition actions"
                    aria-haspopup="menu"
                    aria-expanded={definitionActionsOpen}
                    onClick={() => setDefinitionActionsOpen((prev) => !prev)}
                    title="More actions"
                  >
                    ⋯
                  </AppButton>
                  {definitionActionsOpen ? (
                    <div className="header-menu-popup" role="menu" aria-label="Definition actions menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void onDownloadSessionPng();
                        }}
                        disabled={parseResult === null || sessionPngExportInProgress || isBlockingTaskActive}
                      >
                        {sessionPngExportInProgress ? "Exporting Session PNG..." : "Download Session PNG"}
                      </button>
                      <button type="button" role="menuitem" onClick={onBeautifySource}>
                        Beautify Definition
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <DefinitionEditor
              value={sourceDraft}
              onChange={(next) => {
                setEditorSourceBySystem((prev) => ({ ...prev, [selectedSystemKey]: next }));
              }}
              onBuild={() => compileSystem(selectedSystemKey)}
              jumpRequest={editorJumpRequest}
            />
          </section>
        }
      />
    </div>
  );

  const centerPane = (
    <div className="pane-content center-pane">
      <ViewportPane
        geometrySource={parseResult?.shaderSource ?? "float DE(vec3 p){return length(p)-1.0;}"}
        geometryLineMap={parseResult?.shaderLineMap}
        uniformDefinitions={parseResult?.uniforms ?? []}
        uniformValues={uniformValues}
        integrator={activeIntegrator}
        integratorOptions={activeIntegratorOptions}
        renderSettings={renderSettings}
        cameraState={cameraState}
        slicePlaneLockFrame={slicePlaneLockFrame}
        onCameraChange={onCameraChange}
        onFocusDistance={onFocusDistance}
        onStatus={setStatus}
        onError={onViewportError}
        onGraphicsDiagnostics={setGraphicsDiagnostics}
        disableGlobalShortcuts={
          saveLocalDialog !== null ||
          deleteLocalDialogPath !== null ||
          pendingSwitchEntryKey !== null ||
          sessionGalleryOpen ||
          isBlockingTaskActive ||
          exportDialogState !== null ||
          helpDialogOpen
        }
      />
      <div className="viewport-overlay">
        <span>FPS {status.fps.toFixed(1)}</span>
        <span>
          Subframe {status.subframe}
          {status.maxSubframes === 0 ? "/inf" : `/${status.maxSubframes}`}
        </span>
        <span>Scale {status.scale.toFixed(2)}</span>
        <span>
          Tiles {status.tileCount}x{status.tileCount}
          {status.tileCount > 1 ? ` @${status.tileCursor + 1}` : ""}
        </span>
        <span>
          Buffer {status.resolution[0]}x{status.resolution[1]}
        </span>
      </div>
    </div>
  );

  const rightPane = (
    <div className="pane-content right-pane">
      <section className="section-block">
        <h2>System Preset</h2>
        {parseResult !== null && parseResult.presets.length > 0 ? (
          <select
            value={activePresetBySystem[selectedSystemKey] ?? ""}
            onChange={(event) => {
              const presetName = event.target.value;
              if (presetName.length > 0) {
                onApplyPreset(presetName);
              }
            }}
          >
            <option value="" disabled>
              Select preset
            </option>
            {parseResult.presets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">No presets found in this source.</p>
        )}
      </section>

      <section className="section-block right-pane-tab-shell grow">
        <div className="right-pane-tab-content">
          {activeRightPaneTab === "integrator" ? (
            <>
              <h2>Integrator</h2>
              <select
                value={activeIntegratorId}
                onChange={(event) => onSwitchIntegrator(event.target.value)}
              >
                {INTEGRATORS.map((integrator) => (
                  <option key={integrator.id} value={integrator.id}>
                    {integrator.name}
                  </option>
                ))}
              </select>
              <p className="muted">{activeIntegrator.description}</p>

              <div className="integrator-options">
                {groupedIntegratorOptions.map(({ group, options }) => (
                  <div key={group} className="integrator-option-group">
                    <h3 className="integrator-option-group-title">{group}</h3>
                    {buildIntegratorOptionRenderItems(options).map((item) => {
                      if (item.kind === "single") {
                        const option = item.option;
                        const value = activeIntegratorOptions[option.key] ?? option.defaultValue;
                        const step = optionStep(option);
                        const isToggle = isIntegratorToggleOption(option);
                        const isDefault = isNumericSliderAtDefault(value, option.defaultValue, step);
                        return (
                          <div className="uniform-row" key={option.key}>
                            <span className="uniform-label">{option.label}</span>
                            {isToggle ? (
                              <div className="uniform-inputs uniform-inputs-checkbox">
                                <label
                                  className={`integrator-toggle-checkbox ${isDefault ? "slider-default" : "slider-changed"}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={value >= 0.5}
                                    onChange={(event) =>
                                      onIntegratorOptionChange(option.key, event.target.checked ? 1 : 0)
                                    }
                                  />
                                  <span>{value >= 0.5 ? "On" : "Off"}</span>
                                </label>
                              </div>
                            ) : (
                              <div className="uniform-inputs">
                                <input
                                  className={rangeSliderClassName(value, option.defaultValue, step)}
                                  type="range"
                                  min={option.min}
                                  max={option.max}
                                  step={step}
                                  value={value}
                                  onChange={(event) => onIntegratorOptionChange(option.key, Number(event.target.value))}
                                />
                                <input
                                  className="uniform-number"
                                  type="number"
                                  min={option.min}
                                  max={option.max}
                                  step={step}
                                  value={value}
                                  onChange={(event) => onIntegratorOptionChange(option.key, Number(event.target.value))}
                                />
                              </div>
                            )}
                          </div>
                        );
                      }

                      const triplet = item as IntegratorColorTripletRenderItem;
                      const colorHex = getColorTripletDisplayColorHex(triplet, activeIntegratorOptions);
                      const intensity = getColorTripletIntensity(triplet, activeIntegratorOptions);
                      const defaultIntensity = getColorTripletDefaultIntensity(triplet);
                      const intensityStep = getColorTripletIntensityStep(triplet);
                      const showIntensity = supportsHdrColorTripletIntensity(triplet);
                      const intensityMax = getColorTripletMax(triplet);

                      return (
                        <div className="uniform-vector integrator-color-control" key={`${triplet.r.key}:${triplet.g.key}:${triplet.b.key}`}>
                          <div className="uniform-vector-header">
                            <span className="uniform-label">{triplet.label}</span>
                            <input
                              className="uniform-color-preview uniform-color-picker"
                              type="color"
                              aria-label={`${triplet.label} color`}
                              value={colorHex}
                              onChange={(event) => {
                                onIntegratorOptionPatch(colorTripletPatchFromHex(triplet, activeIntegratorOptions, event.target.value));
                              }}
                            />
                          </div>
                          {showIntensity ? (
                            <div className="uniform-row compact">
                              <span className="uniform-axis">i</span>
                              <div className="uniform-inputs">
                                <input
                                  className={rangeSliderClassName(intensity, defaultIntensity, intensityStep)}
                                  type="range"
                                  min={0}
                                  max={intensityMax}
                                  step={intensityStep}
                                  value={intensity}
                                  onChange={(event) => {
                                    onIntegratorOptionPatch(
                                      colorTripletPatchFromIntensity(
                                        triplet,
                                        activeIntegratorOptions,
                                        Number(event.target.value)
                                      )
                                    );
                                  }}
                                />
                                <input
                                  className="uniform-number"
                                  type="number"
                                  min={0}
                                  max={intensityMax}
                                  step={intensityStep}
                                  value={intensity}
                                  onChange={(event) => {
                                    onIntegratorOptionPatch(
                                      colorTripletPatchFromIntensity(
                                        triplet,
                                        activeIntegratorOptions,
                                        Number(event.target.value)
                                      )
                                    );
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="tab-reset-row">
                <AppButton onClick={onResetActiveIntegratorOptions}>
                  Reset Group
                </AppButton>
              </div>
            </>
          ) : null}

          {activeRightPaneTab === "render" ? (
            <>
              <h2>Render</h2>
              <div className="integrator-options">
                <div className="uniform-row">
                  <span className="uniform-label">Move Res Scale</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(
                        renderSettings.interactionResolutionScale,
                        DEFAULT_RENDER_SETTINGS.interactionResolutionScale,
                        0.05
                      )}
                      type="range"
                      min={0.25}
                      max={1}
                      step={0.05}
                      value={renderSettings.interactionResolutionScale}
                      onChange={(event) =>
                        onRenderSettingChange("interactionResolutionScale", Number(event.target.value))
                      }
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0.25}
                      max={1}
                      step={0.05}
                      value={renderSettings.interactionResolutionScale}
                      onChange={(event) =>
                        onRenderSettingChange("interactionResolutionScale", Number(event.target.value))
                      }
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Max Subframes</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(
                        renderSettings.maxSubframes,
                        DEFAULT_RENDER_SETTINGS.maxSubframes,
                        1
                      )}
                      type="range"
                      min={0}
                      max={200}
                      step={1}
                      value={renderSettings.maxSubframes}
                      onChange={(event) => onRenderSettingChange("maxSubframes", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      value={renderSettings.maxSubframes}
                      onChange={(event) => onRenderSettingChange("maxSubframes", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Tile Count</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(renderSettings.tileCount, DEFAULT_RENDER_SETTINGS.tileCount, 1)}
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={renderSettings.tileCount}
                      onChange={(event) => onRenderSettingChange("tileCount", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={1}
                      max={8}
                      step={1}
                      value={renderSettings.tileCount}
                      onChange={(event) => onRenderSettingChange("tileCount", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Tiles/Frame</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(
                        renderSettings.tilesPerFrame,
                        DEFAULT_RENDER_SETTINGS.tilesPerFrame,
                        1
                      )}
                      type="range"
                      min={1}
                      max={16}
                      step={1}
                      value={renderSettings.tilesPerFrame}
                      onChange={(event) => onRenderSettingChange("tilesPerFrame", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={1}
                      max={16}
                      step={1}
                      value={renderSettings.tilesPerFrame}
                      onChange={(event) => onRenderSettingChange("tilesPerFrame", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Aspect Preset</span>
                  <div className="uniform-inputs render-aspect-preset-inputs">
                    <select
                      value={renderAspectRatioLocked ? selectedRenderAspectPresetId : "custom"}
                      onChange={(event) => onRenderAspectRatioPresetChange(event.target.value)}
                    >
                      <option value="custom">Custom / Viewport</option>
                      {RENDER_ASPECT_RATIO_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <label className="uniform-bool render-aspect-lock-toggle">
                      <span>Lock</span>
                      <input
                        type="checkbox"
                        checked={renderAspectRatioLocked}
                        onChange={(event) => onRenderAspectRatioLockChange(event.target.checked)}
                      />
                    </label>
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Aspect Ratio</span>
                  <div className="uniform-inputs render-aspect-ratio-inputs">
                    <input
                      className="uniform-number"
                      type="number"
                      min={0.01}
                      max={100000}
                      step={0.01}
                      value={renderSettings.aspectRatioX}
                      onChange={(event) => onRenderAspectRatioPartChange("aspectRatioX", event.target.valueAsNumber)}
                    />
                    <span className="render-aspect-ratio-sep" aria-hidden="true">:</span>
                    <input
                      className="uniform-number"
                      type="number"
                      min={0.01}
                      max={100000}
                      step={0.01}
                      value={renderSettings.aspectRatioY}
                      onChange={(event) => onRenderAspectRatioPartChange("aspectRatioY", event.target.valueAsNumber)}
                    />
                  </div>
                </div>
              </div>
              <div className="tab-reset-row">
                <AppButton onClick={onResetRenderGroupSettings}>
                  Reset Group
                </AppButton>
              </div>
            </>
          ) : null}

          {activeRightPaneTab === "post" ? (
            <>
              <h2>Post</h2>
              <div className="integrator-options">
                <div className="uniform-row">
                  <span className="uniform-label">Tone Mapping</span>
                  <div className="uniform-inputs">
                    <select
                      value={renderSettings.toneMapping}
                      onChange={(event) => onRenderSettingChange("toneMapping", Number(event.target.value))}
                    >
                      <option value={1}>Linear</option>
                      <option value={2}>Exponential</option>
                      <option value={3}>Filmic (ACES-like)</option>
                      <option value={4}>Reinhard</option>
                    </select>
                    <input
                      className="uniform-number"
                      type="number"
                      min={1}
                      max={4}
                      step={1}
                      value={renderSettings.toneMapping}
                      onChange={(event) => onRenderSettingChange("toneMapping", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Exposure</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(renderSettings.exposure, DEFAULT_RENDER_SETTINGS.exposure, 0.01)}
                      type="range"
                      min={0}
                      max={8}
                      step={0.01}
                      value={renderSettings.exposure}
                      onChange={(event) => onRenderSettingChange("exposure", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={8}
                      step={0.01}
                      value={renderSettings.exposure}
                      onChange={(event) => onRenderSettingChange("exposure", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Gamma</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(renderSettings.gamma, DEFAULT_RENDER_SETTINGS.gamma, 0.01)}
                      type="range"
                      min={0.2}
                      max={5}
                      step={0.01}
                      value={renderSettings.gamma}
                      onChange={(event) => onRenderSettingChange("gamma", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0.2}
                      max={5}
                      step={0.01}
                      value={renderSettings.gamma}
                      onChange={(event) => onRenderSettingChange("gamma", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Brightness</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(
                        renderSettings.brightness,
                        DEFAULT_RENDER_SETTINGS.brightness,
                        0.01
                      )}
                      type="range"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.brightness}
                      onChange={(event) => onRenderSettingChange("brightness", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.brightness}
                      onChange={(event) => onRenderSettingChange("brightness", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Contrast</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(renderSettings.contrast, DEFAULT_RENDER_SETTINGS.contrast, 0.01)}
                      type="range"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.contrast}
                      onChange={(event) => onRenderSettingChange("contrast", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.contrast}
                      onChange={(event) => onRenderSettingChange("contrast", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Saturation</span>
                  <div className="uniform-inputs">
                    <input
                      className={rangeSliderClassName(
                        renderSettings.saturation,
                        DEFAULT_RENDER_SETTINGS.saturation,
                        0.01
                      )}
                      type="range"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.saturation}
                      onChange={(event) => onRenderSettingChange("saturation", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.saturation}
                      onChange={(event) => onRenderSettingChange("saturation", Number(event.target.value))}
                    />
                  </div>
                </div>
              </div>
              <div className="tab-reset-row">
                <AppButton onClick={onResetPostGroupSettings}>
                  Reset Group
                </AppButton>
              </div>
            </>
          ) : null}

          {selectedUniformGroup !== null && activeRightPaneTab === makeUniformGroupTabId(selectedUniformGroup) ? (
            <>
              <div className="right-pane-uniforms">
                {parseResult !== null ? (
                  visibleUniforms.length > 0 ? (
                    <UniformPanel
                      uniforms={visibleUniforms}
                      values={uniformValues}
                      baselineValues={uniformBaselineValues}
                      onChange={onUniformValueChange}
                    />
                  ) : (
                    <p className="muted">No parameters in this group.</p>
                  )
                ) : (
                  <p className="muted">Compile a system to expose parameters.</p>
                )}
              </div>
              <div className="tab-reset-row">
                <AppButton
                  onClick={onResetActiveUniformGroupSettings}
                  disabled={parseResult === null || visibleUniforms.length === 0}
                >
                  Reset Group
                </AppButton>
              </div>
            </>
          ) : null}
        </div>

        <VerticalTabList
          tabs={rightPaneTabs}
          activeTabId={activeRightPaneTab}
          onChange={(tabId) => setActiveRightPaneTab(tabId)}
        />
      </section>

      <div className="settings-toolbar-actions">
        <div className="settings-copy-actions">
          <div className="header-menu-anchor" ref={settingsCopyActionsRef}>
            <AppButton
              variant="ghost"
              className="header-menu-trigger is-text"
              aria-label="Session actions"
              aria-haspopup="menu"
              aria-expanded={settingsCopyActionsOpen}
              onClick={() => setSettingsCopyActionsOpen((prev) => !prev)}
            >
              Session
            </AppButton>
            {settingsCopyActionsOpen ? (
              <div
                className="header-menu-popup is-upward is-align-start"
                role="menu"
                aria-label="Session actions menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSettingsCopyActionsOpen(false);
                    void onCopySettingsToClipboard();
                  }}
                >
                  Copy Session JSON
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSettingsCopyActionsOpen(false);
                    void onPasteSettingsFromClipboard();
                  }}
                >
                  Paste Session JSON
                </button>
                <button type="button" role="menuitem" onClick={onResetAllSettings}>
                  Reset Session Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={onAppendPresetToDefinition}
                  disabled={parseResult === null}
                >
                  Insert Preset into Definition
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="app-root"
      onDragEnter={onAppDragEnter}
      onDragLeave={onAppDragLeave}
      onDragOver={onAppDragOver}
        onDrop={onAppDrop}
    >
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">{APP_TITLE}</div>
        </div>
        <div className="topbar-center">
          <AppButton
            variant="primary"
            className="topbar-gallery-button"
            onClick={() => setSessionGalleryOpen(true)}
            disabled={isBlockingTaskActive}
          >
            Session Gallery
          </AppButton>
        </div>
        <div className="topbar-actions">
          <AppButton onClick={() => setHelpDialogOpen(true)} disabled={isBlockingTaskActive}>
            Help...
          </AppButton>
          <AppButton
            variant="primary"
            className="topbar-export-button"
            onClick={onOpenExportDialog}
            disabled={isBlockingTaskActive}
          >
            Export Render...
          </AppButton>
        </div>
      </header>

      {dropImportOverlayVisible ? (
        <div className="drop-import-overlay" role="presentation" aria-hidden="true">
          <div className="drop-import-overlay-panel">
            <div className="drop-import-overlay-title">Drop to Import</div>
            <div className="drop-import-overlay-detail">Session PNG or Session Gallery ZIP</div>
          </div>
        </div>
      ) : null}

      <SplitLayout
        leftWidth={leftPanePx}
        rightWidth={rightPanePx}
        minPaneWidth={MIN_PANE_WIDTH}
        onLeftWidthChange={setLeftPanePx}
        onRightWidthChange={setRightPanePx}
        left={leftPane}
        center={centerPane}
        right={rightPane}
      />

      {(compileError !== null || shaderError !== null) && (
        <div className="error-strip">
          <div className="error-strip-messages">
            {compileError !== null && compileErrorPreview !== null ? (
              <div className="error-strip-message">
                <span className="error-strip-message-label">
                  Compile error{compileErrorPreview.truncated ? " (preview)" : ""}:
                </span>
                <pre className="error-strip-message-preview">{compileErrorPreview.text}</pre>
              </div>
            ) : null}
            {shaderError !== null && shaderErrorPreview !== null ? (
              <div className="error-strip-message">
                <span className="error-strip-message-label">
                  Shader error{shaderErrorPreview.truncated ? " (preview)" : ""}:
                </span>
                <pre className="error-strip-message-preview">{shaderErrorPreview.text}</pre>
              </div>
            ) : null}
            {mappedShaderDiagnostics.length > 0 ? (
              <div className="error-strip-diagnostics">
                {mappedShaderDiagnostics.slice(0, 8).map((entry, index) => (
                  <button
                    key={`${entry.mappedSource!.path}:${entry.mappedSource!.line}:${index}`}
                    type="button"
                    className="error-diagnostic-button"
                    onClick={() => onJumpToShaderDiagnostic(index)}
                    title={entry.rawLine}
                  >
                    {entry.mappedSource!.path}:{entry.mappedSource!.line} {entry.message}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <AppButton onClick={() => void onCopyErrorToClipboard()}>
            Copy Error
          </AppButton>
          {errorClipboardStatus !== null ? <span className="error-strip-status">{errorClipboardStatus}</span> : null}
        </div>
      )}

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toastNotifications.map((toast) => (
          <div key={toast.id} className={`toast-item${toast.tone === "error" ? " is-error" : ""}`}>
            {toast.message}
          </div>
        ))}
      </div>

      <SaveLocalSystemDialog
        open={saveLocalDialog !== null}
        pathValue={saveLocalDialog?.pathValue ?? ""}
        errorMessage={saveLocalDialog?.errorMessage ?? null}
        isOverwrite={saveDialogIsOverwrite}
        onPathChange={(next) =>
          setSaveLocalDialog((prev) => {
            if (prev === null) {
              return prev;
            }
            return {
              pathValue: next,
              errorMessage: null
            };
          })
        }
        onCancel={onCancelSaveLocalDialog}
        onSave={() => void onConfirmSaveLocalDialog()}
      />
      <ConfirmDiscardChangesDialog
        open={pendingSwitchEntryKey !== null || pendingSessionPngImport !== null}
        targetLabel={pendingDiscardTargetLabel}
        onCancel={onCancelDiscardSwitchDialog}
        onConfirm={onConfirmDiscardSwitchDialog}
      />
      <ExportRenderDialog
        open={exportDialogState !== null}
        canAnimate={parseResult !== null && parseResult.presets.length > 0}
        mode={exportDialogState?.mode ?? "still"}
        width={exportDialogState?.width ?? 1920}
        height={exportDialogState?.height ?? 1080}
        aspectRatioLocked={exportDialogState?.aspectRatioLocked ?? true}
        aspectRatio={exportDialogState?.aspectRatio ?? ((exportDialogState?.width ?? 1920) / Math.max(1, exportDialogState?.height ?? 1080))}
        subframes={exportDialogState?.subframes ?? Math.max(1, renderSettings.maxSubframes || 30)}
        frameCount={exportDialogState?.frameCount ?? 100}
        presetNames={exportPresetNames}
        startPresetName={exportDialogState?.startPresetName ?? null}
        endPresetName={exportDialogState?.endPresetName ?? null}
        interpolation={exportDialogState?.interpolation ?? "linear"}
        previewFrame={exportDialogState?.previewFrame ?? 0}
        movieSupported={webCodecsMovieAvailable}
        movieUnavailableReason={
          webCodecsMovieAvailable ? null : "WebCodecs VideoEncoder is not available in this browser context."
        }
        movieCodec={exportDialogState?.movieCodec ?? "vp9"}
        movieFps={exportDialogState?.movieFps ?? 30}
        movieBitrateMbps={exportDialogState?.movieBitrateMbps ?? 12}
        movieKeyframeInterval={exportDialogState?.movieKeyframeInterval ?? 30}
        changedValues={exportChangedValues}
        statusMessage={exportDialogState?.statusMessage ?? null}
        isExporting={exportProgressState !== null}
        progress={exportProgressState}
        onClose={onCloseExportDialog}
        onStartExport={() => void onStartExportRender()}
        onStartMovieExport={() => void onStartMovieExportRender()}
        onCancelExport={onCancelExportRender}
        onModeChange={(mode) => {
          if (mode === "still") {
            restoreExportPreviewSnapshot();
          }
          updateExportDialogState({
            mode,
            statusMessage: null
          });
        }}
        onWidthChange={onExportWidthChange}
        onHeightChange={onExportHeightChange}
        onAspectRatioLockChange={onExportAspectRatioLockChange}
        onSubframesChange={(value) =>
          updateExportDialogState({ subframes: Math.max(1, value), statusMessage: null })
        }
        onFrameCountChange={(value) =>
          setExportDialogState((prev) => {
            if (prev === null) {
              return prev;
            }
            const nextFrameCount = Math.max(1, value);
            return {
              ...prev,
              frameCount: nextFrameCount,
              previewFrame: Math.min(prev.previewFrame, Math.max(0, nextFrameCount - 1)),
              statusMessage: null
            };
          })
        }
        onStartPresetChange={(name) =>
          setExportDialogState((prev) => (prev === null ? prev : { ...prev, startPresetName: name, statusMessage: null }))
        }
        onEndPresetChange={(name) =>
          setExportDialogState((prev) => (prev === null ? prev : { ...prev, endPresetName: name, statusMessage: null }))
        }
        onInterpolationChange={(mode) => updateExportDialogState({ interpolation: mode, statusMessage: null })}
        onMovieCodecChange={(codec) => updateExportDialogState({ movieCodec: codec, statusMessage: null })}
        onMovieFpsChange={(value) => updateExportDialogState({ movieFps: Math.max(1, value), statusMessage: null })}
        onMovieBitrateMbpsChange={(value) =>
          updateExportDialogState({ movieBitrateMbps: Math.max(0.1, value), statusMessage: null })
        }
        onMovieKeyframeIntervalChange={(value) =>
          updateExportDialogState({ movieKeyframeInterval: Math.max(1, value), statusMessage: null })
        }
        onPreviewFrameChange={(value) =>
          setExportDialogState((prev) => {
            if (prev === null) {
              return prev;
            }
            return {
              ...prev,
              previewFrame: Math.max(0, Math.min(Math.max(0, prev.frameCount - 1), Math.round(value))),
              statusMessage: null
            };
          })
        }
      />
      <SessionGalleryDialog
        open={sessionGalleryOpen}
        items={sessionGalleryItems}
        externalSources={sessionGalleryExternalSources}
        storageInfo={sessionGalleryStorageInfo}
        isBusy={isBlockingTaskActive}
        persistentStorageRequestInProgress={persistentStorageRequestInProgress}
        onClose={() => setSessionGalleryOpen(false)}
        onOpenSession={onOpenSessionFromGallery}
        onDeleteSession={onDeleteSessionFromGallery}
        onRenameSession={onRenameSessionFromGallery}
        onRequestPersistentStorage={onRequestPersistentStorage}
        onExportAll={() => void onExportAllSessionsZip()}
        onImportZip={onImportSessionsZip}
        onAddExternalGitHubSource={onAddExternalGitHubGallerySource}
        onRefreshExternalSource={onRefreshExternalGitHubGallerySource}
        onRemoveExternalSource={onRemoveExternalGitHubGallerySource}
      />
      <ConfirmDeleteLocalSystemDialog
        open={deleteLocalDialogPath !== null}
        localPath={deleteLocalDialogPath}
        onCancel={() => setDeleteLocalDialogPath(null)}
        onConfirm={() => void onConfirmDeleteLocalSystem()}
      />
      <BlockingTaskDialog
        open={blockingTask !== null}
        title={blockingTask?.title ?? "Working"}
        message={blockingTask?.message ?? ""}
        detail={blockingTask?.detail ?? null}
        progress={blockingTask?.progress ?? null}
      />
      <HelpDialog
        open={helpDialogOpen}
        versionLabel={APP_VERSION_LABEL}
        graphicsDiagnostics={graphicsDiagnostics}
        onClose={() => setHelpDialogOpen(false)}
      />
    </div>
  );
}
