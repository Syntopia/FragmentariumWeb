import type { CameraState } from "../core/geometry/camera";
import { cross, length, normalize, scale, sub, type Vec3 } from "../core/geometry/vector";
import {
  basisFromQuat,
  quatFromBasis,
  quatFromLookOrientation,
  slerpQuat
} from "../core/geometry/quaternion";
import type { UniformDefinition, UniformValue } from "../core/parser/types";

export type ExportInterpolationMode = "linear" | "ease-in-out";

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

    out[definition.name] = start.map((entry, index) => lerp(Number(entry), Number(end[index]), t));
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
