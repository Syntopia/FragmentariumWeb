import { getDefaultIntegratorOptions, getIntegratorById } from "../core/integrators/definitions";
import type { IntegratorOptionValues } from "../core/integrators/types";
import type { UniformValue } from "../core/parser/types";
import { DEFAULT_RENDER_SETTINGS } from "../core/render/renderer";
import type { RenderSettings, SlicePlaneLockFrame } from "../core/render/renderer";
import type { CameraState } from "../core/geometry/camera";
import { clampDirectionComponents, normalizeDirectionArray } from "../utils/direction";
import {
  DEFAULT_TIMELINE_PLAYBACK_DURATION_SECONDS,
  cloneTimelineState,
  type SessionTimelinePatch,
  type SessionTimelineSlicePlanePatch,
  type SessionTimelineState
} from "./timeline";

export const SETTINGS_CLIPBOARD_FORMAT = "fragmentarium-web-settings-v1";

export interface SettingsClipboardSystemDefinition {
  source: string;
  treePath: string | null;
  sourcePath: string | null;
  selectedSystemKey: string | null;
}

export interface SettingsClipboardPayload {
  format: typeof SETTINGS_CLIPBOARD_FORMAT;
  selectedPresetName: string | null;
  integratorId: string;
  integratorOptions: IntegratorOptionValues;
  renderSettings: RenderSettings;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
  slicePlaneLockFrame?: SlicePlaneLockFrame | null;
  timeline?: SessionTimelineState | null;
  systemDefinition?: SettingsClipboardSystemDefinition;
}

interface BuildSettingsClipboardPayloadArgs {
  selectedPresetName: string | null;
  integratorId: string;
  integratorOptions: IntegratorOptionValues;
  renderSettings: RenderSettings;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
  slicePlaneLockFrame?: SlicePlaneLockFrame | null;
  timeline?: SessionTimelineState | null;
  systemDefinition?: SettingsClipboardSystemDefinition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }
  return value;
}

function asStringOrNull(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }
  return value;
}

function asOptionalStringOrNull(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }
  return value;
}

function asCameraState(value: unknown): CameraState {
  if (!isRecord(value)) {
    throw new Error("Invalid 'camera' value in clipboard payload.");
  }

  const eye = asVec3(value.eye, "camera.eye");
  const target = asVec3(value.target, "camera.target");
  const up = asVec3(value.up, "camera.up");
  const fov = asFiniteNumber(value.fov, "camera.fov");

  return { eye, target, up, fov };
}

function asSlicePlaneLockFrame(value: unknown): SlicePlaneLockFrame | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid 'slicePlaneLockFrame' value in clipboard payload.");
  }
  return {
    origin: asVec3(value.origin, "slicePlaneLockFrame.origin"),
    normal: asVec3(value.normal, "slicePlaneLockFrame.normal")
  };
}

const RENDER_SETTINGS_PATCH_KEYS = new Set<keyof RenderSettings>([
  "interactionResolutionScale",
  "maxSubframes",
  "tileCount",
  "tilesPerFrame",
  "aspectRatioLocked",
  "aspectRatioX",
  "aspectRatioY",
  "toneMapping",
  "exposure",
  "gamma",
  "brightness",
  "contrast",
  "saturation"
]);

function asRenderSettingsPatch(value: unknown, fieldName: string): Partial<RenderSettings> {
  if (!isRecord(value)) {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }
  const next: Partial<RenderSettings> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!RENDER_SETTINGS_PATCH_KEYS.has(key as keyof RenderSettings)) {
      throw new Error(`Invalid '${fieldName}.${key}' value in clipboard payload.`);
    }
    next[key as keyof RenderSettings] = asFiniteNumber(raw, `${fieldName}.${key}`);
  }
  return next;
}

function asTimelineSlicePlanePatch(value: unknown, fieldName: string): SessionTimelineSlicePlanePatch {
  if (!isRecord(value)) {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }
  if (value.kind === "null") {
    return { kind: "null" };
  }
  if (value.kind === "value") {
    return {
      kind: "value",
      value: {
        origin: asVec3(value.value !== undefined && isRecord(value.value) ? value.value.origin : undefined, `${fieldName}.value.origin`),
        normal: asVec3(value.value !== undefined && isRecord(value.value) ? value.value.normal : undefined, `${fieldName}.value.normal`)
      }
    };
  }
  throw new Error(`Invalid '${fieldName}.kind' value in clipboard payload.`);
}

function asTimelinePatch(value: unknown, fieldName: string): SessionTimelinePatch {
  if (!isRecord(value)) {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }

  const patch: SessionTimelinePatch = {};

  if (value.integratorId !== undefined) {
    if (typeof value.integratorId !== "string" || value.integratorId.length === 0) {
      throw new Error(`Invalid '${fieldName}.integratorId' value in clipboard payload.`);
    }
    patch.integratorId = value.integratorId;
  }
  if (value.integratorOptions !== undefined) {
    patch.integratorOptions = asIntegratorOptions(value.integratorOptions);
  }
  if (value.renderSettings !== undefined) {
    patch.renderSettings = asRenderSettingsPatch(value.renderSettings, `${fieldName}.renderSettings`);
  }
  if (value.uniformValues !== undefined) {
    patch.uniformValues = asUniformValueMap(value.uniformValues);
  }
  if (value.camera !== undefined) {
    patch.camera = asCameraState(value.camera);
  }
  if (value.slicePlaneLockFrame !== undefined) {
    patch.slicePlaneLockFrame = asTimelineSlicePlanePatch(value.slicePlaneLockFrame, `${fieldName}.slicePlaneLockFrame`);
  }

  return patch;
}

function asTimelineState(value: unknown): SessionTimelineState | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid 'timeline' value in clipboard payload.");
  }
  if (value.version !== 1) {
    throw new Error("Invalid 'timeline.version' value in clipboard payload.");
  }
  if (!isRecord(value.baseline)) {
    throw new Error("Invalid 'timeline.baseline' value in clipboard payload.");
  }
  if (!Array.isArray(value.keyframes) || value.keyframes.length === 0) {
    throw new Error("Invalid 'timeline.keyframes' value in clipboard payload.");
  }
  if (typeof value.activeKeyId !== "string" || value.activeKeyId.length === 0) {
    throw new Error("Invalid 'timeline.activeKeyId' value in clipboard payload.");
  }
  const interpolation = value.interpolation;
  if (
    interpolation !== "linear" &&
    interpolation !== "ease-in-out" &&
    interpolation !== "monotone-cubic" &&
    interpolation !== "catmull-rom"
  ) {
    throw new Error("Invalid 'timeline.interpolation' value in clipboard payload.");
  }
  const playheadT = asFiniteNumber(value.playheadT, "timeline.playheadT");
  const playbackDurationSeconds =
    value.playbackDurationSeconds === undefined
      ? DEFAULT_TIMELINE_PLAYBACK_DURATION_SECONDS
      : Math.max(0.1, asFiniteNumber(value.playbackDurationSeconds, "timeline.playbackDurationSeconds"));
  if (value.modifyAllKeyframes !== undefined && typeof value.modifyAllKeyframes !== "boolean") {
    throw new Error("Invalid 'timeline.modifyAllKeyframes' value in clipboard payload.");
  }
  const modifyAllKeyframes = value.modifyAllKeyframes === undefined ? false : value.modifyAllKeyframes;

  const baselineSlicePlane = asSlicePlaneLockFrame(value.baseline.slicePlaneLockFrame);
  if (baselineSlicePlane === undefined) {
    throw new Error("Invalid 'timeline.baseline.slicePlaneLockFrame' value in clipboard payload.");
  }
  if (typeof value.baseline.integratorId !== "string" || value.baseline.integratorId.length === 0) {
    throw new Error("Invalid 'timeline.baseline.integratorId' value in clipboard payload.");
  }

  const keyframes = value.keyframes.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid 'timeline.keyframes[${index}]' value in clipboard payload.`);
    }
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new Error(`Invalid 'timeline.keyframes[${index}].id' value in clipboard payload.`);
    }
    return {
      id: entry.id,
      t: asFiniteNumber(entry.t, `timeline.keyframes[${index}].t`),
      patch: asTimelinePatch(entry.patch, `timeline.keyframes[${index}].patch`)
    };
  });

  if (!keyframes.some((entry) => entry.id === value.activeKeyId)) {
    throw new Error("Invalid 'timeline.activeKeyId' value in clipboard payload.");
  }

  return {
    version: 1,
    baseline: {
      integratorId: value.baseline.integratorId,
      integratorOptions: asIntegratorOptions(value.baseline.integratorOptions),
      renderSettings: asRenderSettings(value.baseline.renderSettings),
      uniformValues: asUniformValueMap(value.baseline.uniformValues),
      camera: asCameraState(value.baseline.camera),
      slicePlaneLockFrame: baselineSlicePlane
    },
    keyframes,
    activeKeyId: value.activeKeyId,
    playheadT,
    interpolation,
    playbackDurationSeconds,
    modifyAllKeyframes
  };
}

function asVec3(value: unknown, fieldName: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
  }

  return [
    asFiniteNumber(value[0], `${fieldName}[0]`),
    asFiniteNumber(value[1], `${fieldName}[1]`),
    asFiniteNumber(value[2], `${fieldName}[2]`)
  ];
}

function cloneUniformValue(value: UniformValue): UniformValue {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry));
  }
  return value;
}

function asUniformValue(value: unknown, fieldName: string): UniformValue {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => asFiniteNumber(entry, `${fieldName}[${index}]`));
  }
  throw new Error(`Invalid '${fieldName}' value in clipboard payload.`);
}

function asUniformValueMap(value: unknown): Record<string, UniformValue> {
  if (!isRecord(value)) {
    throw new Error("Invalid 'uniformValues' value in clipboard payload.");
  }

  const next: Record<string, UniformValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    next[key] = asUniformValue(raw, `uniformValues.${key}`);
  }
  return next;
}

function asIntegratorOptions(value: unknown): IntegratorOptionValues {
  if (!isRecord(value)) {
    throw new Error("Invalid 'integratorOptions' value in clipboard payload.");
  }

  const next: IntegratorOptionValues = {};
  for (const [key, raw] of Object.entries(value)) {
    next[key] = asFiniteNumber(raw, `integratorOptions.${key}`);
  }
  return next;
}

function asRenderSettings(value: unknown): RenderSettings {
  if (!isRecord(value)) {
    throw new Error("Invalid 'renderSettings' value in clipboard payload.");
  }

  const aspectRatioLocked =
    value.aspectRatioLocked === undefined
      ? DEFAULT_RENDER_SETTINGS.aspectRatioLocked
      : asFiniteNumber(value.aspectRatioLocked, "renderSettings.aspectRatioLocked");
  const aspectRatioX =
    value.aspectRatioX === undefined
      ? DEFAULT_RENDER_SETTINGS.aspectRatioX
      : asFiniteNumber(value.aspectRatioX, "renderSettings.aspectRatioX");
  const aspectRatioY =
    value.aspectRatioY === undefined
      ? DEFAULT_RENDER_SETTINGS.aspectRatioY
      : asFiniteNumber(value.aspectRatioY, "renderSettings.aspectRatioY");

  return {
    interactionResolutionScale: asFiniteNumber(value.interactionResolutionScale, "renderSettings.interactionResolutionScale"),
    maxSubframes: asFiniteNumber(value.maxSubframes, "renderSettings.maxSubframes"),
    tileCount: asFiniteNumber(value.tileCount, "renderSettings.tileCount"),
    tilesPerFrame: asFiniteNumber(value.tilesPerFrame, "renderSettings.tilesPerFrame"),
    aspectRatioLocked,
    aspectRatioX,
    aspectRatioY,
    toneMapping: asFiniteNumber(value.toneMapping, "renderSettings.toneMapping"),
    exposure: asFiniteNumber(value.exposure, "renderSettings.exposure"),
    gamma: asFiniteNumber(value.gamma, "renderSettings.gamma"),
    brightness: asFiniteNumber(value.brightness, "renderSettings.brightness"),
    contrast: asFiniteNumber(value.contrast, "renderSettings.contrast"),
    saturation: asFiniteNumber(value.saturation, "renderSettings.saturation")
  };
}

function asSystemDefinition(value: unknown): SettingsClipboardSystemDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid 'systemDefinition' value in clipboard payload.");
  }
  if (typeof value.source !== "string" || value.source.length === 0) {
    throw new Error("Invalid 'systemDefinition.source' value in clipboard payload.");
  }

  return {
    source: value.source,
    treePath: asOptionalStringOrNull(value.treePath, "systemDefinition.treePath"),
    sourcePath: asOptionalStringOrNull(value.sourcePath, "systemDefinition.sourcePath"),
    selectedSystemKey: asOptionalStringOrNull(value.selectedSystemKey, "systemDefinition.selectedSystemKey")
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function coerceIntegratorOptionsForId(
  integratorId: string,
  candidate: IntegratorOptionValues
): IntegratorOptionValues {
  const integrator = getIntegratorById(integratorId);
  const defaults = getDefaultIntegratorOptions(integratorId);
  const next: IntegratorOptionValues = { ...defaults };
  const directionTriplets = new Map<
    string,
    {
      x?: typeof integrator.options[number];
      y?: typeof integrator.options[number];
      z?: typeof integrator.options[number];
    }
  >();

  for (const option of integrator.options) {
    const raw = candidate[option.key];
    if (raw === undefined) {
      // keep default
    } else {
      next[option.key] = clamp(raw, option.min, option.max);
    }

    if (option.control !== "direction") {
      continue;
    }
    const axisMatch = /^(.*)(X|Y|Z)$/.exec(option.key);
    if (axisMatch === null || axisMatch[1].length === 0) {
      throw new Error(`Direction option '${option.key}' must end with X, Y, or Z.`);
    }
    const existing = directionTriplets.get(axisMatch[1]) ?? {};
    if (axisMatch[2] === "X") {
      existing.x = option;
    } else if (axisMatch[2] === "Y") {
      existing.y = option;
    } else {
      existing.z = option;
    }
    directionTriplets.set(axisMatch[1], existing);
  }

  for (const [baseKey, triplet] of directionTriplets) {
    if (triplet.x === undefined || triplet.y === undefined || triplet.z === undefined) {
      throw new Error(`Direction option triplet '${baseKey}' is incomplete.`);
    }
    const clamped = clampDirectionComponents([
      clamp(next[triplet.x.key], triplet.x.min, triplet.x.max),
      clamp(next[triplet.y.key], triplet.y.min, triplet.y.max),
      clamp(next[triplet.z.key], triplet.z.min, triplet.z.max)
    ]);
    const normalized = normalizeDirectionArray(clamped, `Integrator option '${baseKey}'`);
    next[triplet.x.key] = normalized[0];
    next[triplet.y.key] = normalized[1];
    next[triplet.z.key] = normalized[2];
  }
  return next;
}

export function buildSettingsClipboardPayload(
  args: BuildSettingsClipboardPayloadArgs
): SettingsClipboardPayload {
  const payload: SettingsClipboardPayload = {
    format: SETTINGS_CLIPBOARD_FORMAT,
    selectedPresetName: args.selectedPresetName,
    integratorId: args.integratorId,
    integratorOptions: { ...args.integratorOptions },
    renderSettings: { ...args.renderSettings },
    uniformValues: Object.fromEntries(
      Object.entries(args.uniformValues).map(([key, value]) => [key, cloneUniformValue(value)])
    ),
    camera: {
      eye: [...args.camera.eye],
      target: [...args.camera.target],
      up: [...args.camera.up],
      fov: args.camera.fov
    },
    slicePlaneLockFrame:
      args.slicePlaneLockFrame === undefined
        ? undefined
        : args.slicePlaneLockFrame === null
          ? null
          : {
              origin: [...args.slicePlaneLockFrame.origin],
              normal: [...args.slicePlaneLockFrame.normal]
            },
    timeline:
      args.timeline === undefined
        ? undefined
        : args.timeline === null
          ? null
          : cloneTimelineState(args.timeline)
  };

  if (args.systemDefinition !== undefined) {
    payload.systemDefinition = {
      source: args.systemDefinition.source,
      treePath: args.systemDefinition.treePath,
      sourcePath: args.systemDefinition.sourcePath,
      selectedSystemKey: args.systemDefinition.selectedSystemKey
    };
  }

  return payload;
}

export function serializeSettingsClipboardPayload(payload: SettingsClipboardPayload): string {
  return JSON.stringify(payload, null, 2);
}

function buildSessionComparisonShape(payload: SettingsClipboardPayload): unknown {
  return {
    format: payload.format,
    selectedPresetName: payload.selectedPresetName,
    integratorId: payload.integratorId,
    integratorOptions: payload.integratorOptions,
    renderSettings: payload.renderSettings,
    uniformValues: payload.uniformValues,
    camera: payload.camera,
    slicePlaneLockFrame: payload.slicePlaneLockFrame,
    timeline: payload.timeline,
    systemDefinition:
      payload.systemDefinition === undefined
        ? undefined
        : {
            source: payload.systemDefinition.source
          }
  };
}

export function serializeSettingsClipboardPayloadForSessionComparison(
  payload: SettingsClipboardPayload
): string {
  return JSON.stringify(buildSessionComparisonShape(payload));
}

export function parseSettingsClipboardPayload(raw: string): SettingsClipboardPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Clipboard payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Clipboard payload must be a JSON object.");
  }

  if (parsed.format !== SETTINGS_CLIPBOARD_FORMAT) {
    throw new Error(`Clipboard payload format must be '${SETTINGS_CLIPBOARD_FORMAT}'.`);
  }

  if (typeof parsed.integratorId !== "string" || parsed.integratorId.length === 0) {
    throw new Error("Invalid 'integratorId' value in clipboard payload.");
  }

  return {
    format: SETTINGS_CLIPBOARD_FORMAT,
    selectedPresetName: asStringOrNull(parsed.selectedPresetName, "selectedPresetName"),
    integratorId: parsed.integratorId,
    integratorOptions: asIntegratorOptions(parsed.integratorOptions),
    renderSettings: asRenderSettings(parsed.renderSettings),
    uniformValues: asUniformValueMap(parsed.uniformValues),
    camera: asCameraState(parsed.camera),
    slicePlaneLockFrame: asSlicePlaneLockFrame(parsed.slicePlaneLockFrame),
    timeline: asTimelineState(parsed.timeline),
    systemDefinition: asSystemDefinition(parsed.systemDefinition)
  };
}
