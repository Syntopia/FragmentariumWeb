import type { CameraState } from "../core/geometry/camera";
import { cross, length, normalize, scale, sub, type Vec3 } from "../core/geometry/vector";
import {
  basisFromQuat,
  quatFromBasis,
  quatFromLookOrientation,
  slerpQuat
} from "../core/geometry/quaternion";
import type { UniformDefinition, UniformValue } from "../core/parser/types";
import { normalizeDirectionArray } from "../utils/direction";

export type ExportInterpolationMode =
  | "linear"
  | "ease-in-out"
  | "monotone-cubic"
  | "catmull-rom";

export interface ChangedValueSummary {
  name: string;
  from: string;
  to: string;
  category: "uniform" | "camera";
}

const CAMERA_UNIFORM_NAMES = new Set(["Eye", "Target", "Up", "FOV"]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyInterpolationMode(mode: ExportInterpolationMode, tRaw: number): number {
  const t = clamp01(tRaw);
  if (mode === "ease-in-out") {
    return t * t * (3 - 2 * t); // smoothstep
  }
  return t;
}

interface InterpolateScalarSegmentArgs {
  mode: ExportInterpolationMode;
  segmentT: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  xPrev?: number;
  yPrev?: number;
  xNext?: number;
  yNext?: number;
}

function safeSpan(x0: number, x1: number): number {
  return Math.max(1e-6, x1 - x0);
}

function slope(y0: number, y1: number, x0: number, x1: number): number {
  return (y1 - y0) / safeSpan(x0, x1);
}

function sameSign(a: number, b: number): boolean {
  return (a < 0 && b < 0) || (a > 0 && b > 0);
}

function hermiteInterpolate(y0: number, y1: number, m0: number, m1: number, segmentT: number, h: number): number {
  const t = clamp01(segmentT);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}

function catmullRomTangent(
  xPrev: number | undefined,
  yPrev: number | undefined,
  x0: number,
  y0: number,
  xNext: number | undefined,
  yNext: number | undefined
): number {
  if (xPrev === undefined || yPrev === undefined) {
    if (xNext === undefined || yNext === undefined) {
      return 0;
    }
    return slope(y0, yNext, x0, xNext);
  }
  if (xNext === undefined || yNext === undefined) {
    return slope(yPrev, y0, xPrev, x0);
  }
  const hPrev = safeSpan(xPrev, x0);
  const hNext = safeSpan(x0, xNext);
  const dPrev = (y0 - yPrev) / hPrev;
  const dNext = (yNext - y0) / hNext;
  return (hNext * dPrev + hPrev * dNext) / Math.max(1e-6, hPrev + hNext);
}

function monotoneTangentInternal(xPrev: number, yPrev: number, x0: number, y0: number, xNext: number, yNext: number): number {
  const hPrev = safeSpan(xPrev, x0);
  const hNext = safeSpan(x0, xNext);
  const dPrev = (y0 - yPrev) / hPrev;
  const dNext = (yNext - y0) / hNext;
  if (!sameSign(dPrev, dNext)) {
    return 0;
  }
  const w1 = 2 * hNext + hPrev;
  const w2 = hNext + 2 * hPrev;
  return (w1 + w2) / ((w1 / dPrev) + (w2 / dNext));
}

function monotoneTangentStart(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number | undefined,
  y2: number | undefined
): number {
  const d0 = slope(y0, y1, x0, x1);
  if (x2 === undefined || y2 === undefined) {
    return d0;
  }
  const h0 = safeSpan(x0, x1);
  const h1 = safeSpan(x1, x2);
  const d1 = (y2 - y1) / h1;
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / Math.max(1e-6, h0 + h1);
  if (!sameSign(m, d0)) {
    m = 0;
  } else if (!sameSign(d0, d1) && Math.abs(m) > Math.abs(3 * d0)) {
    m = 3 * d0;
  }
  return m;
}

function monotoneTangentEnd(
  xPrev: number | undefined,
  yPrev: number | undefined,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dLast = slope(y0, y1, x0, x1);
  if (xPrev === undefined || yPrev === undefined) {
    return dLast;
  }
  const hLast = safeSpan(x0, x1);
  const hPrev = safeSpan(xPrev, x0);
  const dPrev = (y0 - yPrev) / hPrev;
  let m = ((2 * hLast + hPrev) * dLast - hLast * dPrev) / Math.max(1e-6, hLast + hPrev);
  if (!sameSign(m, dLast)) {
    m = 0;
  } else if (!sameSign(dLast, dPrev) && Math.abs(m) > Math.abs(3 * dLast)) {
    m = 3 * dLast;
  }
  return m;
}

export function interpolateScalarSegment(args: InterpolateScalarSegmentArgs): number {
  const t = clamp01(args.segmentT);
  if (!Number.isFinite(args.y0) || !Number.isFinite(args.y1)) {
    return Number.isFinite(args.y0) ? args.y0 : args.y1;
  }
  const h = safeSpan(args.x0, args.x1);
  if (args.mode === "linear" || args.mode === "ease-in-out") {
    const eased = applyInterpolationMode(args.mode, t);
    return lerp(args.y0, args.y1, eased);
  }

  if (args.mode === "catmull-rom") {
    const m0 = catmullRomTangent(args.xPrev, args.yPrev, args.x0, args.y0, args.x1, args.y1);
    const m1 = catmullRomTangent(args.x0, args.y0, args.x1, args.y1, args.xNext, args.yNext);
    return hermiteInterpolate(args.y0, args.y1, m0, m1, t, h);
  }

  const m0 =
    args.xPrev !== undefined && args.yPrev !== undefined
      ? monotoneTangentInternal(args.xPrev, args.yPrev, args.x0, args.y0, args.x1, args.y1)
      : monotoneTangentStart(args.x0, args.y0, args.x1, args.y1, args.xNext, args.yNext);
  const m1 =
    args.xNext !== undefined && args.yNext !== undefined
      ? monotoneTangentInternal(args.x0, args.y0, args.x1, args.y1, args.xNext, args.yNext)
      : monotoneTangentEnd(args.xPrev, args.yPrev, args.x0, args.y0, args.x1, args.y1);
  return hermiteInterpolate(args.y0, args.y1, m0, m1, t, h);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) < 1e-12) {
    return "0";
  }
  return Number(value).toPrecision(6).replace(/\.?0+$/g, "");
}

export function formatUniformValueForSummary(value: UniformValue): string {
  if (Array.isArray(value)) {
    return `(${value.map((entry) => formatNumber(Number(entry))).join(", ")})`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return formatNumber(Number(value));
}

function valuesEqual(a: UniformValue | undefined, b: UniformValue | undefined): boolean {
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
      if (Math.abs(Number(a[i]) - Number(b[i])) > 1e-6) {
        return false;
      }
    }
    return true;
  }
  return Math.abs(Number(a) - Number(b)) <= 1e-6;
}

function cameraStatesEqual(a: CameraState, b: CameraState): boolean {
  return (
    valuesEqual(a.eye, b.eye) &&
    valuesEqual(a.target, b.target) &&
    valuesEqual(a.up, b.up) &&
    valuesEqual(a.fov, b.fov)
  );
}

export function buildChangedUniformSummaries(
  definitions: UniformDefinition[],
  startValues: Record<string, UniformValue>,
  endValues: Record<string, UniformValue>
): ChangedValueSummary[] {
  const entries: ChangedValueSummary[] = [];
  for (const definition of definitions) {
    if (CAMERA_UNIFORM_NAMES.has(definition.name)) {
      continue;
    }
    const start = startValues[definition.name] ?? definition.defaultValue;
    const end = endValues[definition.name] ?? definition.defaultValue;
    if (valuesEqual(start, end)) {
      continue;
    }
    entries.push({
      name: definition.name,
      from: formatUniformValueForSummary(start),
      to: formatUniformValueForSummary(end),
      category: "uniform"
    });
  }
  return entries;
}

export function buildChangedCameraSummaries(start: CameraState, end: CameraState): ChangedValueSummary[] {
  const out: ChangedValueSummary[] = [];
  const pushIfChanged = (name: string, fromValue: UniformValue, toValue: UniformValue): void => {
    if (valuesEqual(fromValue, toValue)) {
      return;
    }
    out.push({
      name,
      from: formatUniformValueForSummary(fromValue),
      to: formatUniformValueForSummary(toValue),
      category: "camera"
    });
  };

  pushIfChanged("Eye", [...start.eye], [...end.eye]);
  pushIfChanged("Target", [...start.target], [...end.target]);
  pushIfChanged("Up", [...start.up], [...end.up]);
  pushIfChanged("FOV", start.fov, end.fov);

  return out;
}

export function interpolateUniformValues(
  definitions: UniformDefinition[],
  startValues: Record<string, UniformValue>,
  endValues: Record<string, UniformValue>,
  tRaw: number
): Record<string, UniformValue> {
  const t = clamp01(tRaw);
  const out: Record<string, UniformValue> = {};

  for (const definition of definitions) {
    const start = startValues[definition.name] ?? definition.defaultValue;
    const end = endValues[definition.name] ?? definition.defaultValue;

    if (definition.type === "bool") {
      out[definition.name] = start;
      continue;
    }
    if (definition.type === "int") {
      out[definition.name] = Math.round(lerp(Number(start), Number(end), t));
      continue;
    }
    if (definition.type === "float") {
      out[definition.name] = lerp(Number(start), Number(end), t);
      continue;
    }

    if (!Array.isArray(start) || !Array.isArray(end) || start.length !== end.length) {
      out[definition.name] = Array.isArray(start) ? [...start] : start;
      continue;
    }

    const interpolated = start.map((entry, index) => lerp(Number(entry), Number(end[index]), t));
    if (definition.control === "direction") {
      out[definition.name] = normalizeDirectionArray(interpolated, `Uniform '${definition.name}' direction`);
      continue;
    }
    out[definition.name] = interpolated;
  }

  return out;
}

export function interpolateCameraState(start: CameraState, end: CameraState, tRaw: number): CameraState {
  const t = clamp01(tRaw);
  if (cameraStatesEqual(start, end)) {
    return {
      eye: [...start.eye],
      target: [...start.target],
      up: [...start.up],
      fov: start.fov
    };
  }
  if (t <= 0) {
    return {
      eye: [...start.eye],
      target: [...start.target],
      up: [...start.up],
      fov: start.fov
    };
  }
  if (t >= 1) {
    return {
      eye: [...end.eye],
      target: [...end.target],
      up: [...end.up],
      fov: end.fov
    };
  }
  const interpolatedTarget = lerpVec3(start.target, end.target, t);
  const startDirRaw = sub(start.target, start.eye);
  const endDirRaw = sub(end.target, end.eye);
  const startDistance = Math.max(length(startDirRaw), 1e-6);
  const endDistance = Math.max(length(endDirRaw), 1e-6);

  // Recommended approach (orbit camera):
  // 1) build look-at orientation quaternions from eye/target/up
  // 2) slerp the rotation
  // 3) lerp target + camera distance
  // 4) reconstruct eye from forward direction and distance
  const q0 = quatFromLookAt(startDirRaw, start.up);
  const q1 = quatFromLookAt(endDirRaw, end.up);
  const q = slerpQuat(q0, q1, t);
  const frame = lookAtFrameFromQuat(q);

  const distance = lerp(startDistance, endDistance, t);
  const eye = sub(interpolatedTarget, scale(frame.forward, distance));

  return {
    eye,
    target: interpolatedTarget,
    up: frame.trueUp,
    fov: lerp(start.fov, end.fov, t)
  };
}

function quatFromLookAt(dirRaw: Vec3, upHintRaw: Vec3) {
  const frame = orthonormalLookAtFrame(dirRaw, upHintRaw);
  // Convention: quaternion basis uses +Z as basis.forward. To match the common look-at camera
  // convention, store -forward in the matrix (equivalent to the user's "(right, up, -forward)").
  return quatFromBasis(frame.right, frame.trueUp, scale(frame.forward, -1));
}

function lookAtFrameFromQuat(q: ReturnType<typeof quatFromLookAt>): {
  forward: Vec3;
  right: Vec3;
  trueUp: Vec3;
} {
  const basis = basisFromQuat(q);
  const forward = normalize(scale(basis.forward, -1));
  // Re-orthonormalize every frame to avoid drift and keep a proper look-at frame.
  let right = cross(forward, basis.up);
  const rightLen = length(right);
  if (!Number.isFinite(rightLen) || rightLen <= 1e-8) {
    const fallbackUp: Vec3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    right = cross(forward, fallbackUp);
  }
  right = normalize(right);
  const trueUp = normalize(cross(right, forward));
  return { forward, right, trueUp };
}

function orthonormalLookAtFrame(dirRaw: Vec3, upHintRaw: Vec3): {
  forward: Vec3;
  right: Vec3;
  trueUp: Vec3;
} {
  const forward = normalize(dirRaw);
  let right = cross(forward, upHintRaw);
  const rightLen = length(right);
  if (!Number.isFinite(rightLen) || rightLen <= 1e-8) {
    const fallbackUp: Vec3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    right = cross(forward, fallbackUp);
  }
  right = normalize(right);
  const trueUp = normalize(cross(right, forward));
  return { forward, right, trueUp };
}

export function normalizedFrameT(frameIndex: number, frameCount: number): number {
  const total = Math.max(1, Math.round(frameCount));
  if (total <= 1) {
    return 0;
  }
  const index = Math.max(0, Math.min(total - 1, Math.round(frameIndex)));
  return index / (total - 1);
}

export function buildInterpolatedExportState(args: {
  frameIndex: number;
  frameCount: number;
  interpolation: ExportInterpolationMode;
  uniformDefinitions: UniformDefinition[];
  startUniformValues: Record<string, UniformValue>;
  endUniformValues: Record<string, UniformValue>;
  startCamera: CameraState;
  endCamera: CameraState;
}): { uniformValues: Record<string, UniformValue>; camera: CameraState; t: number; easedT: number } {
  const t = normalizedFrameT(args.frameIndex, args.frameCount);
  const easedT = applyInterpolationMode(args.interpolation, t);
  const camera = interpolateCameraState(args.startCamera, args.endCamera, easedT);
  const uniformValues = interpolateUniformValues(
    args.uniformDefinitions,
    args.startUniformValues,
    args.endUniformValues,
    easedT
  );
  // Keep camera uniforms aligned with the exported camera interpolation so preview/export do not diverge.
  for (const [name, value] of Object.entries(cameraToUniformMap(camera))) {
    if (args.uniformDefinitions.some((definition) => definition.name === name)) {
      uniformValues[name] = value;
    }
  }
  return {
    uniformValues,
    camera,
    t,
    easedT
  };
}

export function formatEtaSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "Estimating…";
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function blendCameraWithUniformOverrides(
  camera: CameraState,
  values: Record<string, UniformValue>
): CameraState {
  const next: CameraState = {
    eye: [...camera.eye],
    target: [...camera.target],
    up: [...camera.up],
    fov: camera.fov
  };

  const eye = values.Eye;
  if (Array.isArray(eye) && eye.length === 3) {
    next.eye = [Number(eye[0]), Number(eye[1]), Number(eye[2])];
  }
  const target = values.Target;
  if (Array.isArray(target) && target.length === 3) {
    next.target = [Number(target[0]), Number(target[1]), Number(target[2])];
  }
  const up = values.Up;
  if (Array.isArray(up) && up.length === 3) {
    next.up = [Number(up[0]), Number(up[1]), Number(up[2])];
  }
  const fov = values.FOV;
  if (typeof fov === "number" && Number.isFinite(fov)) {
    next.fov = fov;
  }

  return next;
}

export function cameraToUniformMap(camera: CameraState): Record<string, UniformValue> {
  return {
    Eye: [...camera.eye],
    Target: [...camera.target],
    Up: [...camera.up],
    FOV: camera.fov
  };
}
