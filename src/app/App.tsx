import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefinitionEditor } from "../components/DefinitionEditor";
import { AppButton } from "../components/AppButton";
import { ConfirmDiscardChangesDialog } from "../components/ConfirmDiscardChangesDialog";
import { ConfirmDeleteLocalSystemDialog } from "../components/ConfirmDeleteLocalSystemDialog";
import { SaveLocalSystemDialog } from "../components/SaveLocalSystemDialog";
import { ExportRenderDialog, type ExportRenderDialogProgress } from "../components/ExportRenderDialog";
import { HelpDialog } from "../components/HelpDialog";
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
  type RenderSettings,
  type SlicePlaneLockFrame,
  type RendererShaderErrorDetails,
  type RendererStatus
} from "../core/render/renderer";
import { FRACTAL_SYSTEMS, SYSTEM_INCLUDE_MAP, type FractalSystemDefinition } from "../systems/registry";
import { loadStoredSessions, saveStoredSessions } from "../utils/sessionStore";
import {
  WebCodecsWebmEncoder,
  checkWebCodecsMovieSupport,
  isWebCodecsMovieExportAvailable,
  type WebCodecsMovieCodec
} from "../utils/webcodecsWebmEncoder";
import { buildZipStoreBlob } from "../utils/zipStore";
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
import packageJson from "../../package.json";

const MIN_PANE_WIDTH = 240;
const MIN_LEFT_SECTION_HEIGHT = 140;
const EXPORT_STILL_TILE_THRESHOLD_PIXELS = 2048 * 2048;
const EXPORT_STILL_TILE_SIZE = 1024;
const DEFAULT_STARTUP_INTEGRATOR_ID = "de-pathtracer-physical";
const ERROR_STRIP_PREVIEW_MAX_LINES = 12;
const ERROR_STRIP_PREVIEW_MAX_CHARS = 2400;
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
  const defaultSystemId = FRACTAL_SYSTEMS.find((system) => system.id === "mandelbulb")?.id ?? FRACTAL_SYSTEMS[0].id;
  const fallbackSelectionKey = makePresetEntryKey(defaultSystemId);
  const defaults: InitialState = {
    leftPanePx: 380,
    rightPanePx: 380,
    leftSystemsPaneHeightPx: 220,
    selectedSystemKey: fallbackSelectionKey,
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

  try {
    const storedSessions = loadStoredSessions();
    if (Object.keys(storedSessions).length === 0) {
      return defaults;
    }

    const nextSourcesByPath: Record<string, string> = {};
    const nextPayloadsByPath: Record<string, SettingsClipboardPayload> = {};
    const nextEditorSourceBySystem = { ...defaults.editorSourceBySystem };
    const nextSlicePlaneLockFrameBySystem: Record<string, SlicePlaneLockFrame | null> = {};
    const invalidPaths: string[] = [];

    for (const [path, rawJson] of Object.entries(storedSessions)) {
      try {
        const payload = parseSettingsClipboardPayload(rawJson);
        const source = payload.systemDefinition?.source;
        if (typeof source !== "string" || source.length === 0) {
          invalidPaths.push(path);
          continue;
        }
        nextPayloadsByPath[path] = payload;
        nextSourcesByPath[path] = source;
        const entryKey = makeLocalEntryKey(path);
        nextEditorSourceBySystem[entryKey] = source;
        if (payload.slicePlaneLockFrame !== undefined) {
          nextSlicePlaneLockFrameBySystem[entryKey] =
            payload.slicePlaneLockFrame === null ? null : cloneSlicePlaneLockFrame(payload.slicePlaneLockFrame);
        }
      } catch {
        invalidPaths.push(path);
      }
    }

    return {
      ...defaults,
      localSystemsByPath: nextSourcesByPath,
      localSessionPayloadsByPath: nextPayloadsByPath,
      editorSourceBySystem: nextEditorSourceBySystem,
      slicePlaneLockFrameBySystem: nextSlicePlaneLockFrameBySystem,
      persistenceError:
        invalidPaths.length > 0
          ? `Skipped ${invalidPaths.length} invalid saved session${invalidPaths.length === 1 ? "" : "s"}.`
          : null
    };
  } catch (error) {
    return {
      ...defaults,
      persistenceError: error instanceof Error ? error.message : String(error)
    };
  }
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
  return {
    interactionResolutionScale: clamp(
      source.interactionResolutionScale ?? DEFAULT_RENDER_SETTINGS.interactionResolutionScale,
      0.25,
      1
    ),
    maxSubframes: Math.max(0, Math.round(source.maxSubframes ?? DEFAULT_RENDER_SETTINGS.maxSubframes)),
    tileCount: Math.max(1, Math.round(source.tileCount ?? DEFAULT_RENDER_SETTINGS.tileCount)),
    tilesPerFrame: Math.max(1, Math.round(source.tilesPerFrame ?? DEFAULT_RENDER_SETTINGS.tilesPerFrame)),
    toneMapping: Math.round(clamp(source.toneMapping ?? DEFAULT_RENDER_SETTINGS.toneMapping, 1, 4)),
    exposure: clamp(source.exposure ?? DEFAULT_RENDER_SETTINGS.exposure, 0, 8),
    gamma: clamp(source.gamma ?? DEFAULT_RENDER_SETTINGS.gamma, 0.2, 5),
    brightness: clamp(source.brightness ?? DEFAULT_RENDER_SETTINGS.brightness, 0, 5),
    contrast: clamp(source.contrast ?? DEFAULT_RENDER_SETTINGS.contrast, 0, 5),
    saturation: clamp(source.saturation ?? DEFAULT_RENDER_SETTINGS.saturation, 0, 5)
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

function buildSystemsTreeNodes(localSystemsByPath: Record<string, string>): SystemsTreeNode[] {
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

  const localRoot: SystemsTreeFolderNode = {
    type: "folder",
    id: "local-root",
    name: "Sessions",
    children: []
  };

  const ensureLocalFolder = (
    parent: SystemsTreeFolderNode,
    folderName: string,
    fullPath: string
  ): SystemsTreeFolderNode => {
    const existing = parent.children.find(
      (child) => child.type === "folder" && child.id === `local-folder:${fullPath}`
    );
    if (existing !== undefined && existing.type === "folder") {
      return existing;
    }

    const next: SystemsTreeFolderNode = {
      type: "folder",
      id: `local-folder:${fullPath}`,
      name: folderName,
      children: []
    };
    parent.children.push(next);
    return next;
  };

  for (const localPath of Object.keys(localSystemsByPath).sort((a, b) => a.localeCompare(b))) {
    const segments = localPath.split("/").filter((entry) => entry.length > 0);
    if (segments.length === 0) {
      continue;
    }

    let folder = localRoot;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i];
      const fullPath = segments.slice(0, i + 1).join("/");
      folder = ensureLocalFolder(folder, name, fullPath);
    }

    const leafName = segments[segments.length - 1];
    folder.children.push({
      type: "leaf",
      id: `local-leaf:${localPath}`,
      name: leafName,
      entryKey: makeLocalEntryKey(localPath),
      localPath
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
  sortNodeChildren(localRoot);

  return [
    ...presetRoot.children,
    localRoot
  ];
}

export function App(): JSX.Element {
  const initial = useMemo(buildInitialState, []);

  const [leftPanePx, setLeftPanePx] = useState(initial.leftPanePx);
  const [rightPanePx, setRightPanePx] = useState(initial.rightPanePx);
  const [leftSystemsPaneHeightPx, setLeftSystemsPaneHeightPx] = useState(initial.leftSystemsPaneHeightPx);
  const [selectedSystemKey, setSelectedSystemKey] = useState(initial.selectedSystemKey);
  const [activeIntegratorId, setActiveIntegratorId] = useState(initial.activeIntegratorId);

  const [localSystemsByPath, setLocalSystemsByPath] = useState(initial.localSystemsByPath);
  const [localSessionPayloadsByPath, setLocalSessionPayloadsByPath] = useState(initial.localSessionPayloadsByPath);
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
  const [definitionActionsOpen, setDefinitionActionsOpen] = useState(false);
  const [settingsCopyActionsOpen, setSettingsCopyActionsOpen] = useState(false);
  const [exportDialogState, setExportDialogState] = useState<ExportDialogState | null>(null);
  const [exportProgressState, setExportProgressState] = useState<ExportProgressState | null>(null);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [activeUniformGroupBySystem, setActiveUniformGroupBySystem] = useState<Record<string, string>>({});
  const nextToastIdRef = useRef(1);
  const toastTimeoutIdsRef = useRef<number[]>([]);
  const definitionActionsRef = useRef<HTMLDivElement>(null);
  const settingsCopyActionsRef = useRef<HTMLDivElement>(null);
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const exportPreviewSnapshotRef = useRef<ExportPreviewSnapshot | null>(null);

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
  const saveButtonLabel = isEditingLocalSystem ? "Update Session" : "Save Session";
  const saveDialogNormalizedPath =
    saveLocalDialog === null ? null : normalizeLocalPath(saveLocalDialog.pathValue);
  const saveDialogIsOverwrite =
    saveDialogNormalizedPath !== null && localSessionPayloadsByPath[saveDialogNormalizedPath] !== undefined;

  const systemsTreeNodes = useMemo(
    () => buildSystemsTreeNodes(localSystemsByPath),
    [localSystemsByPath]
  );
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
      const defaultId = FRACTAL_SYSTEMS.find((system) => system.id === "mandelbulb")?.id ?? FRACTAL_SYSTEMS[0].id;
      setSelectedSystemKey(makePresetEntryKey(defaultId));
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
    const serialized = Object.fromEntries(
      Object.entries(localSessionPayloadsByPath).map(([path, payload]) => [path, serializeSettingsClipboardPayload(payload)])
    );
    saveStoredSessions(serialized);
  }, [localSessionPayloadsByPath]);

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

    setExportDialogState({
      mode: "still",
      width: Math.max(1, estimatedWidth),
      height: Math.max(1, estimatedHeight),
      aspectRatioLocked: true,
      aspectRatio: Math.max(1, estimatedWidth) / Math.max(1, estimatedHeight),
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
    const STILL_RENDER_PROGRESS_END = 0.94;
    const STILL_ENCODE_PROGRESS = 0.985;
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
          updateProgress(STILL_ENCODE_PROGRESS, 0, 1, "Encoding PNG...");
          await yieldToUiFrames();
          pngBlob = await exportRenderer.captureDisplayPngBlob();
        }
        if (abortController.signal.aborted) {
          throw createExportAbortErrorLocal();
        }

        updateProgress(STILL_DOWNLOAD_PREP_PROGRESS, 0, 1, "Preparing download...");
        await yieldToUiFrames();

        downloadBlob(
          pngBlob,
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

  const onPasteSettingsFromClipboard = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || typeof navigator.clipboard.readText !== "function") {
        throw new Error("Clipboard API readText is unavailable in this browser context.");
      }

      const raw = await navigator.clipboard.readText();
      const payload = parseSettingsClipboardPayload(raw);
      let targetParseResult = parseResult;

      if (payload.systemDefinition !== undefined) {
        const incomingSource = payload.systemDefinition.source;
        setEditorSourceBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: incomingSource
        }));

        try {
          const parsedIncoming = parseFragmentSource({
            source: incomingSource,
            sourceName: getSourceName(selectedSystemKey),
            includeMap: SYSTEM_INCLUDE_MAP
          });
          targetParseResult = parsedIncoming;
          setParsedBySystem((prev) => ({
            ...prev,
            [selectedSystemKey]: parsedIncoming
          }));
          setCompileError(null);
          console.info(`[app] Applied embedded system definition from clipboard into '${selectedSystemKey}'.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setCompileError(message);
          throw new Error(`Embedded system definition failed to compile: ${message}`);
        }
      }

      const nextIntegratorId = normalizeIntegratorId(payload.integratorId);
      const hasIntegrator = INTEGRATORS.some((entry) => entry.id === nextIntegratorId);
      if (!hasIntegrator) {
        throw new Error(`Clipboard payload references unknown integrator '${payload.integratorId}'.`);
      }
      setActiveIntegratorId(nextIntegratorId);

      const nextIntegratorOptions = coerceIntegratorOptionsForId(nextIntegratorId, payload.integratorOptions);
      setIntegratorOptionsById((prev) => ({
        ...prev,
        [nextIntegratorId]: nextIntegratorOptions
      }));

      const nextRenderSettings = coerceRenderSettings(payload.renderSettings);
      setRenderSettings(nextRenderSettings);
      setSlicePlaneLockFrameBySystem((prev) => ({
        ...prev,
        [selectedSystemKey]:
          payload.slicePlaneLockFrame === undefined || payload.slicePlaneLockFrame === null
            ? null
            : cloneSlicePlaneLockFrame(payload.slicePlaneLockFrame)
      }));

      if (targetParseResult !== null) {
        const nextUniformValues = coerceUniformValues(targetParseResult.uniforms, payload.uniformValues);
        const nextCamera = deriveCameraFromUniformValues(targetParseResult.uniforms, nextUniformValues, payload.camera);

        setUniformValuesBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: nextUniformValues
        }));
        setCameraBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: nextCamera
        }));

        if (payload.selectedPresetName !== null) {
          const presetName = payload.selectedPresetName;
          const presetExists = targetParseResult.presets.some((preset) => preset.name === presetName);
          if (presetExists) {
            setActivePresetBySystem((prev) => ({
              ...prev,
              [selectedSystemKey]: presetName
            }));
          }
        }
      } else {
        setUniformValuesBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: payload.uniformValues
        }));
        setCameraBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: payload.camera
        }));
      }

      pushToast("Session JSON pasted from clipboard.");
      console.info(`[app] Pasted session JSON into '${selectedSystemKey}'.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Paste failed: ${message}`, "error");
      console.error(`[app] Failed to paste settings: ${message}`);
    }
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
  };

  const onConfirmDiscardSwitchDialog = (): void => {
    if (pendingSwitchEntryKey === null) {
      return;
    }
    const nextEntryKey = pendingSwitchEntryKey;
    setPendingSwitchEntryKey(null);
    performSwitchSystem(nextEntryKey);
  };

  const saveSourceToLocalPath = (normalizedPath: string): void => {
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
    pushToast(`Session saved: ${normalizedPath}`);
  };

  const deleteLocalSystemByPath = (localPath: string): void => {
    const entryKey = makeLocalEntryKey(localPath);

    setLocalSessionPayloadsByPath((prev) => {
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
      const defaultId = FRACTAL_SYSTEMS.find((system) => system.id === "mandelbulb")?.id ?? FRACTAL_SYSTEMS[0].id;
      setSelectedSystemKey(makePresetEntryKey(defaultId));
    }
  };

  const onDeleteLocalSystem = (localPath: string): void => {
    setDeleteLocalDialogPath(localPath);
  };

  const onConfirmDeleteLocalSystem = (): void => {
    if (deleteLocalDialogPath === null) {
      return;
    }
    deleteLocalSystemByPath(deleteLocalDialogPath);
    setDeleteLocalDialogPath(null);
  };

  const onSaveOrUpdateSource = (): void => {
    if (!hasSessionChanges) {
      return;
    }

    if (isEditingLocalSystem && selectedLocalPath !== null) {
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
      setLocalSessionPayloadsByPath((prev) => ({
        ...prev,
        [selectedLocalPath]: payload
      }));
      setLocalSystemsByPath((prev) => ({
        ...prev,
        [selectedLocalPath]: sourceDraft
      }));
      setEditorSourceBySystem((prev) => ({
        ...prev,
        [selectedSystemKey]: sourceDraft
      }));
      pushToast("Session updated.");
      return;
    }

    const suggestedName =
      selectedPresetSystem !== null ? `${selectedPresetSystem.id}/my-session` : "sessions/custom";
    setSaveLocalDialog({
      pathValue: suggestedName,
      errorMessage: null
    });
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

  const onConfirmSaveLocalDialog = (): void => {
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

    saveSourceToLocalPath(normalizedPath);
    setSaveLocalDialog(null);
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
            />
          </section>
        }
        bottom={
          <section className="section-block section-fill">
            <div className="section-header-row">
              <h2>Definition</h2>
              <div className="section-actions">
                <AppButton onClick={() => compileSystem(selectedSystemKey)}>
                  Build (F5)
                </AppButton>
                <AppButton variant="primary" onClick={onSaveOrUpdateSource} disabled={!hasSessionChanges}>
                  {saveButtonLabel}
                </AppButton>
                <div className="header-menu-anchor" ref={definitionActionsRef}>
                  <AppButton
                    variant="ghost"
                    className="header-menu-trigger"
                    aria-label="Definition actions"
                    aria-haspopup="menu"
                    aria-expanded={definitionActionsOpen}
                    onClick={() => setDefinitionActionsOpen((prev) => !prev)}
                  >
                    ...
                  </AppButton>
                  {definitionActionsOpen ? (
                    <div className="header-menu-popup" role="menu" aria-label="Definition actions menu">
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
        disableGlobalShortcuts={
          saveLocalDialog !== null ||
          deleteLocalDialogPath !== null ||
          pendingSwitchEntryKey !== null ||
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
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-title">Fragmentarium Web</div>
        <div className="topbar-actions">
          <AppButton onClick={() => setHelpDialogOpen(true)}>
            Help...
          </AppButton>
          <AppButton variant="primary" className="topbar-export-button" onClick={onOpenExportDialog}>
            Export Render...
          </AppButton>
        </div>
      </header>

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
        onSave={onConfirmSaveLocalDialog}
      />
      <ConfirmDeleteLocalSystemDialog
        open={deleteLocalDialogPath !== null}
        localPath={deleteLocalDialogPath}
        onCancel={() => setDeleteLocalDialogPath(null)}
        onConfirm={onConfirmDeleteLocalSystem}
      />
      <ConfirmDiscardChangesDialog
        open={pendingSwitchEntryKey !== null}
        targetLabel={pendingSwitchTargetLabel}
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
      <HelpDialog
        open={helpDialogOpen}
        versionLabel={`v${packageJson.version}`}
        onClose={() => setHelpDialogOpen(false)}
      />
    </div>
  );
}
