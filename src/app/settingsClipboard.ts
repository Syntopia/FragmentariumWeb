import { getDefaultIntegratorOptions, getIntegratorById } from "../core/integrators/definitions";
import type { IntegratorOptionValues } from "../core/integrators/types";
import type { UniformValue } from "../core/parser/types";
import { DEFAULT_RENDER_SETTINGS } from "../core/render/renderer";
import type { RenderSettings, SlicePlaneLockFrame } from "../core/render/renderer";
import type { CameraState } from "../core/geometry/camera";

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

  for (const option of integrator.options) {
    const raw = candidate[option.key];
    if (raw === undefined) {
      continue;
    }
    next[option.key] = clamp(raw, option.min, option.max);
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
            }
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
    systemDefinition: asSystemDefinition(parsed.systemDefinition)
  };
}
