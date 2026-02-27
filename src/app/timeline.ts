import type { CameraState } from "../core/geometry/camera";
import { getIntegratorById } from "../core/integrators/definitions";
import type { IntegratorOptionDefinition, IntegratorOptionValues } from "../core/integrators/types";
import type { UniformDefinition, UniformValue } from "../core/parser/types";
import type { RenderSettings, SlicePlaneLockFrame } from "../core/render/renderer";
import { clampDirectionComponents, normalizeDirectionArray } from "../utils/direction";
import {
  applyInterpolationMode,
  cameraToUniformMap,
  interpolateCameraState,
  interpolateScalarSegment,
  type ExportInterpolationMode
} from "./exportInterpolation";

export interface SessionTimelineSnapshot {
  integratorId: string;
  integratorOptions: IntegratorOptionValues;
  renderSettings: RenderSettings;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
  slicePlaneLockFrame: SlicePlaneLockFrame | null;
}

export type SessionTimelineSlicePlanePatch = { kind: "null" } | { kind: "value"; value: SlicePlaneLockFrame };

export interface SessionTimelinePatch {
  integratorId?: string;
  integratorOptions?: IntegratorOptionValues;
  renderSettings?: Partial<RenderSettings>;
  uniformValues?: Record<string, UniformValue>;
  camera?: CameraState;
  slicePlaneLockFrame?: SessionTimelineSlicePlanePatch;
}

export interface SessionTimelineKeyframe {
  id: string;
  t: number;
  patch: SessionTimelinePatch;
}

export interface SessionTimelineState {
  version: 1;
  baseline: SessionTimelineSnapshot;
  keyframes: SessionTimelineKeyframe[];
  activeKeyId: string;
  playheadT: number;
  interpolation: ExportInterpolationMode;
  playbackDurationSeconds: number;
}

const EPSILON = 1e-6;
export const DEFAULT_TIMELINE_PLAYBACK_DURATION_SECONDS = 3;

let timelineKeyCounter = 0;

const RENDER_SETTINGS_KEYS: Array<keyof RenderSettings> = [
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
];

const RENDER_SETTINGS_INTEGER_KEYS = new Set<keyof RenderSettings>([
  "maxSubframes",
  "tileCount",
  "tilesPerFrame",
  "toneMapping"
]);

const RENDER_SETTINGS_STEP_KEYS = new Set<keyof RenderSettings>(["aspectRatioLocked"]);
const VOLATILE_UNLOCKED_ASPECT_KEYS = new Set<keyof RenderSettings>(["aspectRatioX", "aspectRatioY"]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function cloneUniformValue(value: UniformValue): UniformValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  return value;
}

function cloneUniformMap(values: Record<string, UniformValue>): Record<string, UniformValue> {
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

export function cloneTimelineSnapshot(snapshot: SessionTimelineSnapshot): SessionTimelineSnapshot {
  return {
    integratorId: snapshot.integratorId,
    integratorOptions: { ...snapshot.integratorOptions },
    renderSettings: { ...snapshot.renderSettings },
    uniformValues: cloneUniformMap(snapshot.uniformValues),
    camera: cloneCameraState(snapshot.camera),
    slicePlaneLockFrame: snapshot.slicePlaneLockFrame === null ? null : cloneSlicePlaneLockFrame(snapshot.slicePlaneLockFrame)
  };
}

export function cloneTimelinePatch(patch: SessionTimelinePatch): SessionTimelinePatch {
  return {
    integratorId: patch.integratorId,
    integratorOptions: patch.integratorOptions === undefined ? undefined : { ...patch.integratorOptions },
    renderSettings: patch.renderSettings === undefined ? undefined : { ...patch.renderSettings },
    uniformValues: patch.uniformValues === undefined ? undefined : cloneUniformMap(patch.uniformValues),
    camera: patch.camera === undefined ? undefined : cloneCameraState(patch.camera),
    slicePlaneLockFrame:
      patch.slicePlaneLockFrame === undefined
        ? undefined
        : patch.slicePlaneLockFrame.kind === "null"
          ? { kind: "null" }
          : { kind: "value", value: cloneSlicePlaneLockFrame(patch.slicePlaneLockFrame.value) }
  };
}

export function cloneTimelineState(state: SessionTimelineState): SessionTimelineState {
  return {
    version: 1,
    baseline: cloneTimelineSnapshot(state.baseline),
    keyframes: state.keyframes.map((keyframe) => ({
      id: keyframe.id,
      t: keyframe.t,
      patch: cloneTimelinePatch(keyframe.patch)
    })),
    activeKeyId: state.activeKeyId,
    playheadT: state.playheadT,
    interpolation: state.interpolation,
    playbackDurationSeconds: state.playbackDurationSeconds
  };
}

function uniformValueEquals(a: UniformValue | undefined, b: UniformValue | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (Math.abs(Number(a[i]) - Number(b[i])) > EPSILON) {
        return false;
      }
    }
    return true;
  }
  return Math.abs(Number(a) - Number(b)) <= EPSILON;
}

function cameraEquals(a: CameraState, b: CameraState): boolean {
  return (
    uniformValueEquals(a.eye, b.eye) &&
    uniformValueEquals(a.target, b.target) &&
    uniformValueEquals(a.up, b.up) &&
    uniformValueEquals(a.fov, b.fov)
  );
}

function slicePlaneLockFrameEquals(a: SlicePlaneLockFrame | null, b: SlicePlaneLockFrame | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return uniformValueEquals(a.origin, b.origin) && uniformValueEquals(a.normal, b.normal);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isToggleOption(option: IntegratorOptionDefinition): boolean {
  const step = option.step ?? 0;
  return Math.abs(option.min) <= EPSILON && Math.abs(option.max - 1) <= EPSILON && Math.abs(step - 1) <= EPSILON;
}

function isStepOption(option: IntegratorOptionDefinition): boolean {
  return (option.step ?? 0) >= 1;
}

interface TimelineSegmentContext {
  mode: ExportInterpolationMode;
  segmentT: number;
  prevT: number | undefined;
  startT: number;
  endT: number;
  nextT: number | undefined;
}

function interpolateNumericInSegment(
  context: TimelineSegmentContext,
  startValue: number,
  endValue: number,
  prevValue: number | undefined,
  nextValue: number | undefined
): number {
  return interpolateScalarSegment({
    mode: context.mode,
    segmentT: context.segmentT,
    x0: context.startT,
    x1: context.endT,
    y0: startValue,
    y1: endValue,
    xPrev: prevValue === undefined ? undefined : context.prevT,
    yPrev: prevValue,
    xNext: nextValue === undefined ? undefined : context.nextT,
    yNext: nextValue
  });
}

function interpolateIntegratorOptions(
  args: {
    integratorId: string;
    context: TimelineSegmentContext;
    startOptions: IntegratorOptionValues;
    endOptions: IntegratorOptionValues;
    prevOptions?: IntegratorOptionValues;
    nextOptions?: IntegratorOptionValues;
  }
): IntegratorOptionValues {
  const integrator = getIntegratorById(args.integratorId);
  const out: IntegratorOptionValues = {};
  const directionTriplets = new Map<string, { x?: string; y?: string; z?: string }>();
  const togglePhase =
    args.context.mode === "ease-in-out"
      ? applyInterpolationMode("ease-in-out", args.context.segmentT)
      : args.context.segmentT;

  for (const option of integrator.options) {
    const start = clamp(args.startOptions[option.key] ?? option.defaultValue, option.min, option.max);
    const end = clamp(args.endOptions[option.key] ?? option.defaultValue, option.min, option.max);
    const prevRaw = args.prevOptions?.[option.key];
    const nextRaw = args.nextOptions?.[option.key];
    const prev = prevRaw === undefined ? undefined : clamp(prevRaw, option.min, option.max);
    const next = nextRaw === undefined ? undefined : clamp(nextRaw, option.min, option.max);
    let value = 0;
    if (isToggleOption(option)) {
      value = togglePhase < 0.5 ? start : end;
    } else if (isStepOption(option)) {
      value = Math.round(interpolateNumericInSegment(args.context, start, end, prev, next));
    } else {
      value = interpolateNumericInSegment(args.context, start, end, prev, next);
    }
    out[option.key] = clamp(value, option.min, option.max);

    if (option.control === "direction") {
      const axisMatch = /^(.*)(X|Y|Z)$/.exec(option.key);
      if (axisMatch !== null && axisMatch[1].length > 0) {
        const base = axisMatch[1];
        const current = directionTriplets.get(base) ?? {};
        if (axisMatch[2] === "X") {
          current.x = option.key;
        } else if (axisMatch[2] === "Y") {
          current.y = option.key;
        } else {
          current.z = option.key;
        }
        directionTriplets.set(base, current);
      }
    }
  }

  for (const [label, triplet] of directionTriplets) {
    if (triplet.x === undefined || triplet.y === undefined || triplet.z === undefined) {
      continue;
    }
    const clamped = clampDirectionComponents([out[triplet.x], out[triplet.y], out[triplet.z]]);
    const normalized = normalizeDirectionArray(clamped, `Integrator option '${label}' direction`);
    out[triplet.x] = normalized[0];
    out[triplet.y] = normalized[1];
    out[triplet.z] = normalized[2];
  }

  return out;
}

function interpolateRenderSettings(args: {
  context: TimelineSegmentContext;
  start: RenderSettings;
  end: RenderSettings;
  prev?: RenderSettings;
  next?: RenderSettings;
}): RenderSettings {
  const next: RenderSettings = { ...args.start };
  const togglePhase =
    args.context.mode === "ease-in-out"
      ? applyInterpolationMode("ease-in-out", args.context.segmentT)
      : args.context.segmentT;
  for (const key of RENDER_SETTINGS_KEYS) {
    const startValue = args.start[key];
    const endValue = args.end[key];
    const prevValue = args.prev?.[key];
    const nextValue = args.next?.[key];
    let value = 0;
    if (RENDER_SETTINGS_STEP_KEYS.has(key)) {
      value = togglePhase < 0.5 ? startValue : endValue;
    } else if (RENDER_SETTINGS_INTEGER_KEYS.has(key)) {
      value = Math.round(interpolateNumericInSegment(args.context, startValue, endValue, prevValue, nextValue));
    } else {
      value = interpolateNumericInSegment(args.context, startValue, endValue, prevValue, nextValue);
    }
    next[key] = value as never;
  }
  return next;
}

function asNumericArray(value: UniformValue | undefined, expectedLength: number): number[] | null {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    return null;
  }
  const out: number[] = [];
  for (const entry of value) {
    const numeric = Number(entry);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    out.push(numeric);
  }
  return out;
}

function interpolateUniformValuesInSegment(args: {
  definitions: UniformDefinition[];
  context: TimelineSegmentContext;
  startValues: Record<string, UniformValue>;
  endValues: Record<string, UniformValue>;
  prevValues?: Record<string, UniformValue>;
  nextValues?: Record<string, UniformValue>;
}): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {};
  for (const definition of args.definitions) {
    const start = args.startValues[definition.name] ?? definition.defaultValue;
    const end = args.endValues[definition.name] ?? definition.defaultValue;
    const prev = args.prevValues?.[definition.name];
    const next = args.nextValues?.[definition.name];

    if (definition.type === "bool") {
      out[definition.name] = start;
      continue;
    }
    if (definition.type === "int") {
      out[definition.name] = Math.round(
        interpolateNumericInSegment(
          args.context,
          Number(start),
          Number(end),
          prev === undefined ? undefined : Number(prev),
          next === undefined ? undefined : Number(next)
        )
      );
      continue;
    }
    if (definition.type === "float") {
      out[definition.name] = interpolateNumericInSegment(
        args.context,
        Number(start),
        Number(end),
        prev === undefined ? undefined : Number(prev),
        next === undefined ? undefined : Number(next)
      );
      continue;
    }

    if (!Array.isArray(start) || !Array.isArray(end) || start.length !== end.length) {
      out[definition.name] = Array.isArray(start) ? [...start] : start;
      continue;
    }

    const prevArray = asNumericArray(prev, start.length);
    const nextArray = asNumericArray(next, start.length);
    const interpolated = start.map((entry, index) =>
      interpolateNumericInSegment(
        args.context,
        Number(entry),
        Number(end[index]),
        prevArray === null ? undefined : prevArray[index],
        nextArray === null ? undefined : nextArray[index]
      )
    );
    if (definition.control === "direction") {
      out[definition.name] = normalizeDirectionArray(interpolated, `Uniform '${definition.name}' direction`);
      continue;
    }
    out[definition.name] = interpolated;
  }
  return out;
}

function patchEquals(a: SessionTimelinePatch, b: SessionTimelinePatch): boolean {
  if (a.integratorId !== b.integratorId) {
    return false;
  }

  const compareNumberRecord = (
    left: Record<string, number> | undefined,
    right: Record<string, number> | undefined
  ): boolean => {
    if (left === undefined || right === undefined) {
      return left === right;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const lv = left[key];
      const rv = right[key];
      if (lv === undefined || rv === undefined) {
        if (lv !== rv) {
          return false;
        }
        continue;
      }
      if (Math.abs(lv - rv) > EPSILON) {
        return false;
      }
    }
    return true;
  };

  if (!compareNumberRecord(a.integratorOptions, b.integratorOptions)) {
    return false;
  }
  if (!compareNumberRecord(a.renderSettings as Record<string, number> | undefined, b.renderSettings as Record<string, number> | undefined)) {
    return false;
  }

  const leftUniforms = a.uniformValues;
  const rightUniforms = b.uniformValues;
  if (leftUniforms === undefined || rightUniforms === undefined) {
    if (leftUniforms !== rightUniforms) {
      return false;
    }
  } else {
    const uniformKeys = new Set([...Object.keys(leftUniforms), ...Object.keys(rightUniforms)]);
    for (const key of uniformKeys) {
      if (!uniformValueEquals(leftUniforms[key], rightUniforms[key])) {
        return false;
      }
    }
  }

  if (a.camera === undefined || b.camera === undefined) {
    if (a.camera !== b.camera) {
      return false;
    }
  } else if (!cameraEquals(a.camera, b.camera)) {
    return false;
  }

  if (a.slicePlaneLockFrame === undefined || b.slicePlaneLockFrame === undefined) {
    return a.slicePlaneLockFrame === b.slicePlaneLockFrame;
  }
  if (a.slicePlaneLockFrame.kind !== b.slicePlaneLockFrame.kind) {
    return false;
  }
  if (a.slicePlaneLockFrame.kind === "value" && b.slicePlaneLockFrame.kind === "value") {
    return slicePlaneLockFrameEquals(a.slicePlaneLockFrame.value, b.slicePlaneLockFrame.value);
  }
  return true;
}

function sortedKeyframes(keyframes: SessionTimelineKeyframe[]): SessionTimelineKeyframe[] {
  return [...keyframes].sort((a, b) => {
    if (Math.abs(a.t - b.t) > EPSILON) {
      return a.t - b.t;
    }
    return a.id.localeCompare(b.id);
  });
}

function normalizeKeyframe(keyframe: SessionTimelineKeyframe): SessionTimelineKeyframe {
  return {
    id: keyframe.id,
    t: clamp01(keyframe.t),
    patch: cloneTimelinePatch(keyframe.patch)
  };
}

export function createTimelineKeyId(): string {
  timelineKeyCounter += 1;
  return `k${Date.now().toString(36)}_${timelineKeyCounter.toString(36)}`;
}

export function buildTimelineSnapshot(args: {
  integratorId: string;
  integratorOptions: IntegratorOptionValues;
  renderSettings: RenderSettings;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
  slicePlaneLockFrame: SlicePlaneLockFrame | null;
}): SessionTimelineSnapshot {
  return {
    integratorId: args.integratorId,
    integratorOptions: { ...args.integratorOptions },
    renderSettings: { ...args.renderSettings },
    uniformValues: cloneUniformMap(args.uniformValues),
    camera: cloneCameraState(args.camera),
    slicePlaneLockFrame: args.slicePlaneLockFrame === null ? null : cloneSlicePlaneLockFrame(args.slicePlaneLockFrame)
  };
}

export function createTimelineState(snapshot: SessionTimelineSnapshot): SessionTimelineState {
  const keyId = createTimelineKeyId();
  return {
    version: 1,
    baseline: cloneTimelineSnapshot(snapshot),
    keyframes: [
      {
        id: keyId,
        t: 0.5,
        patch: {}
      }
    ],
    activeKeyId: keyId,
    playheadT: 0.5,
    interpolation: "ease-in-out",
    playbackDurationSeconds: DEFAULT_TIMELINE_PLAYBACK_DURATION_SECONDS
  };
}

export function captureTimelinePatch(
  current: SessionTimelineSnapshot,
  baseline: SessionTimelineSnapshot
): SessionTimelinePatch {
  const patch: SessionTimelinePatch = {};

  if (current.integratorId !== baseline.integratorId) {
    patch.integratorId = current.integratorId;
  }

  const changedIntegratorOptions: IntegratorOptionValues = {};
  const integratorOptionKeys = new Set([
    ...Object.keys(baseline.integratorOptions),
    ...Object.keys(current.integratorOptions)
  ]);
  for (const key of integratorOptionKeys) {
    const baselineValue = baseline.integratorOptions[key];
    const currentValue = current.integratorOptions[key];
    if (baselineValue === undefined || currentValue === undefined) {
      if (baselineValue !== currentValue && currentValue !== undefined) {
        changedIntegratorOptions[key] = currentValue;
      }
      continue;
    }
    if (Math.abs(currentValue - baselineValue) > EPSILON) {
      changedIntegratorOptions[key] = currentValue;
    }
  }
  if (Object.keys(changedIntegratorOptions).length > 0) {
    patch.integratorOptions = changedIntegratorOptions;
  }

  const changedRenderSettings: Partial<RenderSettings> = {};
  const bothAspectUnlocked =
    current.renderSettings.aspectRatioLocked < 0.5 &&
    baseline.renderSettings.aspectRatioLocked < 0.5;
  for (const key of RENDER_SETTINGS_KEYS) {
    if (bothAspectUnlocked && VOLATILE_UNLOCKED_ASPECT_KEYS.has(key)) {
      // Aspect ratios in unlocked mode track viewport size and should not mutate keyframes.
      continue;
    }
    if (Math.abs(current.renderSettings[key] - baseline.renderSettings[key]) > EPSILON) {
      changedRenderSettings[key] = current.renderSettings[key];
    }
  }
  if (Object.keys(changedRenderSettings).length > 0) {
    patch.renderSettings = changedRenderSettings;
  }

  const changedUniforms: Record<string, UniformValue> = {};
  const uniformKeys = new Set([...Object.keys(baseline.uniformValues), ...Object.keys(current.uniformValues)]);
  for (const key of uniformKeys) {
    const baselineValue = baseline.uniformValues[key];
    const currentValue = current.uniformValues[key];
    if (!uniformValueEquals(baselineValue, currentValue) && currentValue !== undefined) {
      changedUniforms[key] = cloneUniformValue(currentValue);
    }
  }
  if (Object.keys(changedUniforms).length > 0) {
    patch.uniformValues = changedUniforms;
  }

  if (!cameraEquals(current.camera, baseline.camera)) {
    patch.camera = cloneCameraState(current.camera);
  }

  if (!slicePlaneLockFrameEquals(current.slicePlaneLockFrame, baseline.slicePlaneLockFrame)) {
    patch.slicePlaneLockFrame =
      current.slicePlaneLockFrame === null
        ? { kind: "null" }
        : { kind: "value", value: cloneSlicePlaneLockFrame(current.slicePlaneLockFrame) };
  }

  return patch;
}

export function resolveTimelineSnapshotFromPatch(
  baseline: SessionTimelineSnapshot,
  patch: SessionTimelinePatch
): SessionTimelineSnapshot {
  const integratorOptions = {
    ...baseline.integratorOptions,
    ...(patch.integratorOptions ?? {})
  };
  const renderSettings = {
    ...baseline.renderSettings,
    ...(patch.renderSettings ?? {})
  };
  const uniformValues = {
    ...cloneUniformMap(baseline.uniformValues),
    ...(patch.uniformValues === undefined ? {} : cloneUniformMap(patch.uniformValues))
  };
  const slicePlaneLockFrame =
    patch.slicePlaneLockFrame === undefined
      ? baseline.slicePlaneLockFrame === null
        ? null
        : cloneSlicePlaneLockFrame(baseline.slicePlaneLockFrame)
      : patch.slicePlaneLockFrame.kind === "null"
        ? null
        : cloneSlicePlaneLockFrame(patch.slicePlaneLockFrame.value);

  return {
    integratorId: patch.integratorId ?? baseline.integratorId,
    integratorOptions,
    renderSettings,
    uniformValues,
    camera: patch.camera === undefined ? cloneCameraState(baseline.camera) : cloneCameraState(patch.camera),
    slicePlaneLockFrame
  };
}

export function findTimelineKeyframe(state: SessionTimelineState, keyId: string): SessionTimelineKeyframe | null {
  return state.keyframes.find((entry) => entry.id === keyId) ?? null;
}

export function findNearestTimelineKeyframeId(keyframes: SessionTimelineKeyframe[], tRaw: number): string | null {
  if (keyframes.length === 0) {
    return null;
  }
  const t = clamp01(tRaw);
  let nearest = keyframes[0];
  let nearestDistance = Math.abs(nearest.t - t);
  for (let i = 1; i < keyframes.length; i += 1) {
    const candidate = keyframes[i];
    const distance = Math.abs(candidate.t - t);
    if (distance + EPSILON < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest.id;
}

export function fitTimelineKeyframes(keyframes: SessionTimelineKeyframe[]): SessionTimelineKeyframe[] {
  if (keyframes.length <= 1) {
    return keyframes.map((entry) => normalizeKeyframe(entry));
  }

  const sorted = sortedKeyframes(keyframes).map((entry) => ({
    id: entry.id,
    t: Number.isFinite(entry.t) ? entry.t : 0,
    patch: cloneTimelinePatch(entry.patch)
  }));
  const first = sorted[0].t;
  const last = sorted[sorted.length - 1].t;
  const range = last - first;
  if (Math.abs(range) <= EPSILON) {
    return sorted.map((entry, index) => ({
      ...entry,
      t: index / Math.max(1, sorted.length - 1)
    }));
  }
  return sorted.map((entry) => ({
    ...entry,
    t: clamp01((entry.t - first) / range)
  }));
}

export function evenlyDistributeTimelineKeyframes(keyframes: SessionTimelineKeyframe[]): SessionTimelineKeyframe[] {
  if (keyframes.length <= 1) {
    return keyframes.map((entry) => normalizeKeyframe(entry));
  }
  const sorted = sortedKeyframes(keyframes).map((entry) => normalizeKeyframe(entry));
  const lastIndex = Math.max(1, sorted.length - 1);
  return sorted.map((entry, index) => ({
    ...entry,
    t: index / lastIndex
  }));
}

export function updateTimelineActiveKeyPatch(
  state: SessionTimelineState,
  snapshot: SessionTimelineSnapshot
): SessionTimelineState {
  const nextPatch = captureTimelinePatch(snapshot, state.baseline);
  let changed = false;
  const nextKeyframes = state.keyframes.map((keyframe) => {
    if (keyframe.id !== state.activeKeyId) {
      return keyframe;
    }
    if (patchEquals(keyframe.patch, nextPatch)) {
      return keyframe;
    }
    changed = true;
    return {
      ...keyframe,
      patch: nextPatch
    };
  });
  if (!changed) {
    return state;
  }
  return {
    ...state,
    keyframes: nextKeyframes
  };
}

export function resolveTimelineKeyframeSnapshot(
  state: SessionTimelineState,
  keyId: string
): SessionTimelineSnapshot | null {
  const keyframe = findTimelineKeyframe(state, keyId);
  if (keyframe === null) {
    return null;
  }
  return resolveTimelineSnapshotFromPatch(state.baseline, keyframe.patch);
}

export function interpolateTimelineSnapshotAt(
  state: SessionTimelineState,
  tRaw: number,
  uniformDefinitions: UniformDefinition[]
): SessionTimelineSnapshot {
  const keys = sortedKeyframes(state.keyframes).map((entry) => normalizeKeyframe(entry));
  const snapshots = keys.map((entry) => resolveTimelineSnapshotFromPatch(state.baseline, entry.patch));
  if (keys.length === 0) {
    return cloneTimelineSnapshot(state.baseline);
  }
  if (keys.length === 1) {
    return cloneTimelineSnapshot(snapshots[0]);
  }

  const t = clamp01(tRaw);
  if (t <= keys[0].t + EPSILON) {
    return cloneTimelineSnapshot(snapshots[0]);
  }
  if (t >= keys[keys.length - 1].t - EPSILON) {
    return cloneTimelineSnapshot(snapshots[keys.length - 1]);
  }

  let segmentIndex = 0;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t - EPSILON && t <= b.t + EPSILON) {
      segmentIndex = i;
      break;
    }
  }

  const startKey = keys[segmentIndex];
  const endKey = keys[segmentIndex + 1];
  const prevKey = segmentIndex > 0 ? keys[segmentIndex - 1] : null;
  const nextKey = segmentIndex + 2 < keys.length ? keys[segmentIndex + 2] : null;
  const startSnapshot = snapshots[segmentIndex];
  const endSnapshot = snapshots[segmentIndex + 1];
  const prevSnapshot = segmentIndex > 0 ? snapshots[segmentIndex - 1] : null;
  const nextSnapshot = segmentIndex + 2 < snapshots.length ? snapshots[segmentIndex + 2] : null;
  const segmentSpan = Math.max(EPSILON, endKey.t - startKey.t);
  const segmentT = clamp01((t - startKey.t) / segmentSpan);
  const cameraT =
    state.interpolation === "ease-in-out"
      ? applyInterpolationMode("ease-in-out", segmentT)
      : segmentT;
  const selectionPhase = cameraT;
  const segmentContext: TimelineSegmentContext = {
    mode: state.interpolation,
    segmentT,
    prevT: prevKey?.t,
    startT: startKey.t,
    endT: endKey.t,
    nextT: nextKey?.t
  };

  const integratorId =
    startSnapshot.integratorId === endSnapshot.integratorId
      ? startSnapshot.integratorId
      : selectionPhase < 0.5
        ? startSnapshot.integratorId
        : endSnapshot.integratorId;

  const integratorOptions =
    startSnapshot.integratorId === endSnapshot.integratorId
      ? interpolateIntegratorOptions({
          integratorId: startSnapshot.integratorId,
          context: segmentContext,
          startOptions: startSnapshot.integratorOptions,
          endOptions: endSnapshot.integratorOptions,
          prevOptions: prevSnapshot?.integratorId === startSnapshot.integratorId ? prevSnapshot.integratorOptions : undefined,
          nextOptions: nextSnapshot?.integratorId === startSnapshot.integratorId ? nextSnapshot.integratorOptions : undefined
        })
      : selectionPhase < 0.5
        ? { ...startSnapshot.integratorOptions }
        : { ...endSnapshot.integratorOptions };

  const renderSettings = interpolateRenderSettings({
    context: segmentContext,
    start: startSnapshot.renderSettings,
    end: endSnapshot.renderSettings,
    prev: prevSnapshot?.renderSettings,
    next: nextSnapshot?.renderSettings
  });
  const camera = interpolateCameraState(startSnapshot.camera, endSnapshot.camera, cameraT);
  const uniformValues = interpolateUniformValuesInSegment({
    definitions: uniformDefinitions,
    context: segmentContext,
    startValues: startSnapshot.uniformValues,
    endValues: endSnapshot.uniformValues,
    prevValues: prevSnapshot?.uniformValues,
    nextValues: nextSnapshot?.uniformValues
  });

  for (const [name, value] of Object.entries(cameraToUniformMap(camera))) {
    if (uniformDefinitions.some((definition) => definition.name === name)) {
      uniformValues[name] = value;
    }
  }

  const slicePlaneLockFrame =
    selectionPhase < 0.5
      ? startSnapshot.slicePlaneLockFrame === null
        ? null
        : cloneSlicePlaneLockFrame(startSnapshot.slicePlaneLockFrame)
      : endSnapshot.slicePlaneLockFrame === null
        ? null
        : cloneSlicePlaneLockFrame(endSnapshot.slicePlaneLockFrame);

  return {
    integratorId,
    integratorOptions,
    renderSettings,
    uniformValues,
    camera,
    slicePlaneLockFrame
  };
}
