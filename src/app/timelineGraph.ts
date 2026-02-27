import type { UniformDefinition, UniformValue } from "../core/parser/types";
import {
  interpolateTimelineSnapshotAt,
  resolveTimelineKeyframeSnapshot,
  type SessionTimelineSnapshot,
  type SessionTimelineState
} from "./timeline";

const GRAPH_EPSILON = 1e-6;
const VOLATILE_UNLOCKED_ASPECT_KEYS = new Set(["aspectRatioX", "aspectRatioY"]);

export interface TimelineGraphPoint {
  t: number;
  value: number;
}

export interface TimelineGraphLine {
  id: string;
  variation: number;
  points: TimelineGraphPoint[];
}

interface BuildTimelineGraphLinesArgs {
  timeline: SessionTimelineState;
  uniformDefinitions: UniformDefinition[];
  sampleCount?: number;
  maxLines?: number;
}

interface ScalarRange {
  min: number;
  max: number;
  variation: number;
}

type CameraMotionAnchor = SessionTimelineSnapshot["camera"];

function normalize01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeSampleCount(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return 120;
  }
  return Math.max(8, Math.round(raw));
}

function normalizeMaxLines(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return 24;
  }
  return Math.max(1, Math.round(raw));
}

function uniformValueToScalarEntries(prefix: string, value: UniformValue): Array<[string, number]> {
  if (typeof value === "number") {
    return [[prefix, value]];
  }
  if (typeof value === "boolean") {
    return [[prefix, value ? 1 : 0]];
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => [`${prefix}[${index}]`, Number(entry)]);
  }
  return [];
}

function flattenSnapshot(
  snapshot: SessionTimelineSnapshot,
  cameraMotionAnchor: CameraMotionAnchor | null = null
): Record<string, number> {
  const scalars: Record<string, number> = {};

  for (const [key, value] of Object.entries(snapshot.integratorOptions)) {
    scalars[`integrator.${key}`] = value;
  }
  for (const [key, value] of Object.entries(snapshot.renderSettings)) {
    if (snapshot.renderSettings.aspectRatioLocked < 0.5 && VOLATILE_UNLOCKED_ASPECT_KEYS.has(key)) {
      continue;
    }
    scalars[`render.${key}`] = value;
  }

  scalars["camera.fov"] = snapshot.camera.fov;
  if (cameraMotionAnchor !== null) {
    const eyeDelta = Math.hypot(
      snapshot.camera.eye[0] - cameraMotionAnchor.eye[0],
      snapshot.camera.eye[1] - cameraMotionAnchor.eye[1],
      snapshot.camera.eye[2] - cameraMotionAnchor.eye[2]
    );
    const targetDelta = Math.hypot(
      snapshot.camera.target[0] - cameraMotionAnchor.target[0],
      snapshot.camera.target[1] - cameraMotionAnchor.target[1],
      snapshot.camera.target[2] - cameraMotionAnchor.target[2]
    );
    const upDelta = Math.hypot(
      snapshot.camera.up[0] - cameraMotionAnchor.up[0],
      snapshot.camera.up[1] - cameraMotionAnchor.up[1],
      snapshot.camera.up[2] - cameraMotionAnchor.up[2]
    );
    scalars["camera.motion"] = eyeDelta + targetDelta + upDelta * 0.5;
  }

  if (snapshot.slicePlaneLockFrame !== null) {
    scalars["slice.origin[0]"] = snapshot.slicePlaneLockFrame.origin[0];
    scalars["slice.origin[1]"] = snapshot.slicePlaneLockFrame.origin[1];
    scalars["slice.origin[2]"] = snapshot.slicePlaneLockFrame.origin[2];
    scalars["slice.normal[0]"] = snapshot.slicePlaneLockFrame.normal[0];
    scalars["slice.normal[1]"] = snapshot.slicePlaneLockFrame.normal[1];
    scalars["slice.normal[2]"] = snapshot.slicePlaneLockFrame.normal[2];
  }

  for (const [key, value] of Object.entries(snapshot.uniformValues)) {
    if (key === "Eye" || key === "Target" || key === "Up" || key === "FOV") {
      continue;
    }
    for (const [scalarKey, scalarValue] of uniformValueToScalarEntries(`uniform.${key}`, value)) {
      scalars[scalarKey] = scalarValue;
    }
  }

  return scalars;
}

function sortedTimelineKeys(state: SessionTimelineState): Array<{ id: string; t: number }> {
  return [...state.keyframes]
    .map((entry) => ({
      id: entry.id,
      t: normalize01(entry.t)
    }))
    .sort((a, b) => {
      if (Math.abs(a.t - b.t) > GRAPH_EPSILON) {
        return a.t - b.t;
      }
      return a.id.localeCompare(b.id);
    });
}

function resolveSortedKeyframeSnapshots(state: SessionTimelineState): SessionTimelineSnapshot[] {
  const keys = sortedTimelineKeys(state);
  if (keys.length <= 1) {
    return [];
  }
  const snapshots: SessionTimelineSnapshot[] = [];
  for (const key of keys) {
    const snapshot = resolveTimelineKeyframeSnapshot(state, key.id);
    if (snapshot === null) {
      continue;
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

function buildKeyframeScalarRanges(
  keyframeSnapshots: SessionTimelineSnapshot[],
  cameraMotionAnchor: CameraMotionAnchor | null
): Map<string, ScalarRange> {
  const keyframeScalars: Record<string, number>[] = keyframeSnapshots.map((snapshot) =>
    flattenSnapshot(snapshot, cameraMotionAnchor)
  );
  if (keyframeScalars.length <= 1) {
    return new Map();
  }

  const keyPresence = new Map<string, number>();
  for (const sample of keyframeScalars) {
    for (const scalarKey of Object.keys(sample)) {
      keyPresence.set(scalarKey, (keyPresence.get(scalarKey) ?? 0) + 1);
    }
  }
  const commonKeys = [...keyPresence.entries()]
    .filter(([, count]) => count === keyframeScalars.length)
    .map(([scalarKey]) => scalarKey);

  const ranges = new Map<string, ScalarRange>();
  for (const scalarKey of commonKeys) {
    const first = keyframeScalars[0][scalarKey];
    if (!Number.isFinite(first)) {
      continue;
    }
    let min = first;
    let max = first;
    for (let i = 1; i < keyframeScalars.length; i += 1) {
      const value = keyframeScalars[i][scalarKey];
      if (!Number.isFinite(value)) {
        min = Number.NaN;
        max = Number.NaN;
        break;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      continue;
    }
    const variation = max - min;
    if (variation <= GRAPH_EPSILON) {
      continue;
    }
    ranges.set(scalarKey, {
      min,
      max,
      variation
    });
  }
  return ranges;
}

export function buildTimelineGraphLines(args: BuildTimelineGraphLinesArgs): TimelineGraphLine[] {
  if (args.timeline.keyframes.length <= 1) {
    return [];
  }

  const sampleCount = normalizeSampleCount(args.sampleCount);
  const maxLines = normalizeMaxLines(args.maxLines);
  const keyframeSnapshots = resolveSortedKeyframeSnapshots(args.timeline);
  if (keyframeSnapshots.length <= 1) {
    return [];
  }
  const cameraMotionAnchor = keyframeSnapshots[0]?.camera ?? null;
  const changedScalarRanges = buildKeyframeScalarRanges(keyframeSnapshots, cameraMotionAnchor);
  if (changedScalarRanges.size === 0) {
    return [];
  }

  const sampledScalars: Record<string, number>[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const t = sampleCount <= 1 ? 0 : sampleIndex / (sampleCount - 1);
    const snapshot = interpolateTimelineSnapshotAt(args.timeline, t, args.uniformDefinitions);
    sampledScalars.push(flattenSnapshot(snapshot, cameraMotionAnchor));
  }

  const lines: TimelineGraphLine[] = [];
  for (const [key, range] of changedScalarRanges.entries()) {
    const values: number[] = sampledScalars.map((sample) => sample[key] as number);
    if (values.some((value) => !Number.isFinite(value))) {
      continue;
    }
    const invRange = 1 / range.variation;
    const points: TimelineGraphPoint[] = values.map((value, index) => ({
      t: sampleCount <= 1 ? 0 : index / (sampleCount - 1),
      value: normalize01((value - range.min) * invRange)
    }));
    lines.push({
      id: key,
      variation: range.variation,
      points
    });
  }

  lines.sort((a, b) => b.variation - a.variation || a.id.localeCompare(b.id));
  return lines.slice(0, maxLines);
}
