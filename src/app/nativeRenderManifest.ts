import type { CameraState } from "../core/geometry/camera";
import { getDefaultIntegratorOptions, getIntegratorById } from "../core/integrators/definitions";
import type { IntegratorOptionValues } from "../core/integrators/types";
import { sanitizeUniformValue } from "../core/parser/uniformState";
import type { UniformDefinition, UniformValue } from "../core/parser/types";
import type { RenderSettings, SlicePlaneLockFrame } from "../core/render/renderer";
import { buildSceneShaderSources } from "../core/render/shaderComposer";

export type NativeUniformBindingKind = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4";

export interface NativeUniformBinding {
  name: string;
  kind: NativeUniformBindingKind;
  value: number | boolean | number[];
}

export type NativeUniformValue = NativeUniformBinding["value"];

export interface NativeBackendTaskConfig {
  width: number;
  height: number;
  maxSubframes: number;
  tileCount: number;
  tilesPerFrame: number;
  timeSeconds: number;
  frameSeedStart: number;
  sceneVertexShader: string;
  sceneFragmentShader: string;
  sceneUniforms: NativeUniformBinding[];
  displayUniforms: NativeUniformBinding[];
}

export interface NativeSystemDefinition {
  source: string;
  treePath: string;
  sourcePath: string;
  selectedSystemKey: string;
}

export interface NativeRenderTaskSnapshot {
  integratorId: string;
  integratorOptions: IntegratorOptionValues;
  renderSettings: RenderSettings;
  uniformValues: Record<string, UniformValue>;
  camera: CameraState;
  slicePlaneLockFrame: SlicePlaneLockFrame | null;
  systemDefinition: NativeSystemDefinition;
  nativeBackend: NativeBackendTaskConfig;
}

export interface NativeRenderTask {
  frameIndex: number;
  frameCount: number;
  timelineT: number;
  seconds: number;
  outputPath: string;
  snapshot: NativeRenderTaskSnapshot;
}

export interface NativeBackendFrameDelta {
  timeSeconds?: number;
  frameSeedStart?: number;
  // Keys are uniform indices encoded as strings ("0", "1", ...).
  sceneUniformValues?: Record<string, NativeUniformValue>;
  // Keys are uniform indices encoded as strings ("0", "1", ...).
  displayUniformValues?: Record<string, NativeUniformValue>;
}

export interface NativeRenderManifestFrame {
  frameIndex: number;
  timelineT: number;
  seconds: number;
  outputPath: string;
  nativeBackendDelta: NativeBackendFrameDelta;
}

export interface AnimationRenderManifestV2 {
  format: "fragmentarium-web-animation-render-manifest-v2";
  version: 2;
  appVersion: string;
  createdAtMs: number;
  source: {
    treePath: string;
    sourcePath: string;
    selectedSystemKey: string;
  };
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  subframes: number;
  interpolation: string;
  baseTask: {
    snapshot: {
      nativeBackend: NativeBackendTaskConfig;
    };
  };
  frames: NativeRenderManifestFrame[];
}

export interface BuildAnimationRenderManifestArgs {
  appVersion: string;
  createdAtMs: number;
  source: {
    treePath: string;
    sourcePath: string;
    selectedSystemKey: string;
  };
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  subframes: number;
  interpolation: string;
  tasks: NativeRenderTask[];
}

export interface BuildNativeRenderTaskArgs {
  frameIndex: number;
  frameCount: number;
  timelineT: number;
  seconds: number;
  width: number;
  height: number;
  subframes: number;
  geometrySource: string;
  geometryLineMap: Array<{ path: string; line: number } | null>;
  uniformDefinitions: UniformDefinition[];
  snapshot: {
    integratorId: string;
    integratorOptions: IntegratorOptionValues;
    renderSettings: RenderSettings;
    uniformValues: Record<string, UniformValue>;
    camera: CameraState;
    slicePlaneLockFrame: SlicePlaneLockFrame | null;
  };
  systemDefinition: NativeSystemDefinition;
}

function asFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function asVec3(value: readonly number[], label: string): [number, number, number] {
  if (value.length !== 3) {
    throw new Error(`${label} must have 3 components.`);
  }
  return [
    asFiniteNumber(Number(value[0]), `${label}[0]`),
    asFiniteNumber(Number(value[1]), `${label}[1]`),
    asFiniteNumber(Number(value[2]), `${label}[2]`)
  ];
}

function normalizeVec3(value: [number, number, number], label: string): [number, number, number] {
  const len = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(len) || len <= 1.0e-6) {
    throw new Error(`${label} must be non-zero.`);
  }
  return [value[0] / len, value[1] / len, value[2] / len];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function targetDistance(camera: CameraState): number {
  const dx = camera.target[0] - camera.eye[0];
  const dy = camera.target[1] - camera.eye[1];
  const dz = camera.target[2] - camera.eye[2];
  return Math.max(Math.hypot(dx, dy, dz), 1.0e-4);
}

function coerceIntegratorOptionValue(raw: number | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(raw, min, max);
}

function uniformDefinitionKind(definition: UniformDefinition): NativeUniformBindingKind {
  return definition.type;
}

function resolveSlicePlane(
  camera: CameraState,
  lockFrame: SlicePlaneLockFrame | null,
  optionValues: Record<string, number>
): { point: [number, number, number]; normal: [number, number, number] } {
  const forward = normalizeVec3(
    [
      camera.target[0] - camera.eye[0],
      camera.target[1] - camera.eye[1],
      camera.target[2] - camera.eye[2]
    ],
    "Camera forward"
  );

  const lockEnabled = (optionValues.slicePlaneLock ?? 0) >= 0.5;
  const distance = optionValues.slicePlaneDistance ?? 2;
  let origin: [number, number, number] = asVec3(camera.eye, "Camera eye");
  let normal: [number, number, number] = forward;

  if (lockEnabled && lockFrame !== null) {
    origin = asVec3(lockFrame.origin, "slicePlaneLockFrame.origin");
    normal = normalizeVec3(asVec3(lockFrame.normal, "slicePlaneLockFrame.normal"), "slicePlaneLockFrame.normal");
  }

  return {
    point: [
      origin[0] + normal[0] * distance,
      origin[1] + normal[1] * distance,
      origin[2] + normal[2] * distance
    ],
    normal
  };
}

function cloneUniformValue(value: UniformValue): UniformValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  return value;
}

function cloneCameraState(camera: CameraState): CameraState {
  return {
    eye: [...camera.eye],
    target: [...camera.target],
    up: [...camera.up],
    fov: camera.fov
  };
}

function cloneSlicePlaneLockFrame(frame: SlicePlaneLockFrame | null): SlicePlaneLockFrame | null {
  if (frame === null) {
    return null;
  }
  return {
    origin: [...frame.origin],
    normal: [...frame.normal]
  };
}

function cloneUniformValues(values: Record<string, UniformValue>): Record<string, UniformValue> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cloneUniformValue(value)]));
}

function cloneNativeUniformValue(value: NativeUniformValue): NativeUniformValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  return value;
}

function cloneNativeUniformBinding(binding: NativeUniformBinding): NativeUniformBinding {
  return {
    name: binding.name,
    kind: binding.kind,
    value: cloneNativeUniformValue(binding.value)
  };
}

function cloneNativeBackendConfig(config: NativeBackendTaskConfig): NativeBackendTaskConfig {
  return {
    width: config.width,
    height: config.height,
    maxSubframes: config.maxSubframes,
    tileCount: config.tileCount,
    tilesPerFrame: config.tilesPerFrame,
    timeSeconds: config.timeSeconds,
    frameSeedStart: config.frameSeedStart,
    sceneVertexShader: config.sceneVertexShader,
    sceneFragmentShader: config.sceneFragmentShader,
    sceneUniforms: config.sceneUniforms.map(cloneNativeUniformBinding),
    displayUniforms: config.displayUniforms.map(cloneNativeUniformBinding)
  };
}

function nativeUniformValueEquals(a: NativeUniformValue, b: NativeUniformValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }
  return a === b;
}

function buildUniformDeltaMap(
  previous: NativeUniformBinding[],
  current: NativeUniformBinding[],
  label: string
): Record<string, NativeUniformValue> {
  if (previous.length !== current.length) {
    throw new Error(`${label} layout mismatch: expected ${previous.length} entries, got ${current.length}.`);
  }

  const next: Record<string, NativeUniformValue> = {};
  for (let index = 0; index < current.length; index += 1) {
    const entry = current[index];
    const previousEntry = previous[index];
    if (previousEntry.name !== entry.name || previousEntry.kind !== entry.kind) {
      throw new Error(
        `${label} layout changed at index ${index}: expected '${previousEntry.name}' (${previousEntry.kind}), got '${entry.name}' (${entry.kind}).`
      );
    }
    if (!nativeUniformValueEquals(previousEntry.value, entry.value)) {
      next[String(index)] = cloneNativeUniformValue(entry.value);
    }
  }

  return next;
}

export function buildNativeRenderTask(args: BuildNativeRenderTaskArgs): NativeRenderTask {
  const integrator = getIntegratorById(args.snapshot.integratorId);
  const integratorDefaults = getDefaultIntegratorOptions(args.snapshot.integratorId);
  const sceneSources = buildSceneShaderSources({
    geometrySource: args.geometrySource,
    geometryLineMap: args.geometryLineMap,
    integrator
  });

  const optionValues: Record<string, number> = {};
  for (const option of integrator.options) {
    const raw = args.snapshot.integratorOptions[option.key];
    optionValues[option.key] = coerceIntegratorOptionValue(raw, option.defaultValue, option.min, option.max);
  }

  const lensAperture = Math.max(optionValues.aperture ?? 0, 0);
  const lensFocalDistance = Math.max(optionValues.focalDistance ?? targetDistance(args.snapshot.camera), 1.0e-4);
  const aaStrength = Math.max(optionValues.aaJitter ?? 1, 0);
  const slicePlane = resolveSlicePlane(args.snapshot.camera, args.snapshot.slicePlaneLockFrame, optionValues);
  const frameSeedStart = Math.max(1, Math.round(args.frameIndex + 1));

  const sceneUniforms: NativeUniformBinding[] = [
    { name: "uResolution", kind: "vec2", value: [args.width, args.height] },
    { name: "uPixelOffset", kind: "vec2", value: [0, 0] },
    { name: "uTime", kind: "float", value: args.seconds },
    { name: "uSubframe", kind: "int", value: 0 },
    { name: "uFrameIndex", kind: "int", value: frameSeedStart },
    { name: "uUseBackbuffer", kind: "bool", value: false },
    { name: "uBackbuffer", kind: "int", value: 0 },
    { name: "uEye", kind: "vec3", value: asVec3(args.snapshot.camera.eye, "camera.eye") },
    { name: "uTarget", kind: "vec3", value: asVec3(args.snapshot.camera.target, "camera.target") },
    { name: "uUp", kind: "vec3", value: asVec3(args.snapshot.camera.up, "camera.up") },
    { name: "uFov", kind: "float", value: asFiniteNumber(args.snapshot.camera.fov, "camera.fov") },
    { name: "uLensAperture", kind: "float", value: lensAperture },
    { name: "uLensFocalDistance", kind: "float", value: lensFocalDistance },
    { name: "uAAStrength", kind: "float", value: aaStrength },
    { name: "uIntegrator_slicePlaneEnabled", kind: "int", value: Math.round(optionValues.slicePlaneEnabled ?? 0) },
    {
      name: "uIntegrator_slicePlaneKeepFarSide",
      kind: "int",
      value: Math.round(optionValues.slicePlaneKeepFarSide ?? 1)
    },
    { name: "uSlicePlaneResolvedPoint", kind: "vec3", value: slicePlane.point },
    { name: "uSlicePlaneResolvedNormal", kind: "vec3", value: slicePlane.normal }
  ];

  for (const definition of args.uniformDefinitions) {
    const rawValue = args.snapshot.uniformValues[definition.name] ?? definition.defaultValue;
    const sanitized = sanitizeUniformValue(definition, rawValue);
    sceneUniforms.push({
      name: definition.name,
      kind: uniformDefinitionKind(definition),
      value: sanitized as number | boolean | number[]
    });
  }

  for (const option of integrator.options) {
    const value = optionValues[option.key] ?? integratorDefaults[option.key];
    const isInt = (option.step ?? 0) === 1 && Number.isInteger(option.defaultValue);
    sceneUniforms.push({
      name: `uIntegrator_${option.key}`,
      kind: isInt ? "int" : "float",
      value: isInt ? Math.trunc(value) : value
    });
  }

  const displayUniforms: NativeUniformBinding[] = [
    { name: "uFrontbuffer", kind: "int", value: 0 },
    { name: "uGamma", kind: "float", value: asFiniteNumber(args.snapshot.renderSettings.gamma, "renderSettings.gamma") },
    {
      name: "uExposure",
      kind: "float",
      value: asFiniteNumber(args.snapshot.renderSettings.exposure, "renderSettings.exposure")
    },
    {
      name: "uToneMapping",
      kind: "int",
      value: Math.round(asFiniteNumber(args.snapshot.renderSettings.toneMapping, "renderSettings.toneMapping"))
    },
    {
      name: "uBrightness",
      kind: "float",
      value: asFiniteNumber(args.snapshot.renderSettings.brightness, "renderSettings.brightness")
    },
    {
      name: "uContrast",
      kind: "float",
      value: asFiniteNumber(args.snapshot.renderSettings.contrast, "renderSettings.contrast")
    },
    {
      name: "uSaturation",
      kind: "float",
      value: asFiniteNumber(args.snapshot.renderSettings.saturation, "renderSettings.saturation")
    }
  ];

  const clampedSubframes = Math.max(1, Math.round(args.subframes));
  const nativeBackend: NativeBackendTaskConfig = {
    width: Math.max(1, Math.round(args.width)),
    height: Math.max(1, Math.round(args.height)),
    maxSubframes: clampedSubframes,
    tileCount: 1,
    tilesPerFrame: 1,
    timeSeconds: args.seconds,
    frameSeedStart,
    sceneVertexShader: sceneSources.vertexSource,
    sceneFragmentShader: sceneSources.fragmentSource,
    sceneUniforms,
    displayUniforms
  };

  const taskRenderSettings: RenderSettings = {
    ...args.snapshot.renderSettings,
    interactionResolutionScale: 1,
    maxSubframes: clampedSubframes,
    tileCount: 1,
    tilesPerFrame: 1
  };

  return {
    frameIndex: args.frameIndex,
    frameCount: args.frameCount,
    timelineT: args.timelineT,
    seconds: args.seconds,
    outputPath: `frame_${String(args.frameIndex).padStart(5, "0")}.png`,
    snapshot: {
      integratorId: args.snapshot.integratorId,
      integratorOptions: { ...args.snapshot.integratorOptions },
      renderSettings: taskRenderSettings,
      uniformValues: cloneUniformValues(args.snapshot.uniformValues),
      camera: cloneCameraState(args.snapshot.camera),
      slicePlaneLockFrame: cloneSlicePlaneLockFrame(args.snapshot.slicePlaneLockFrame),
      systemDefinition: {
        source: args.systemDefinition.source,
        treePath: args.systemDefinition.treePath,
        sourcePath: args.systemDefinition.sourcePath,
        selectedSystemKey: args.systemDefinition.selectedSystemKey
      },
      nativeBackend
    }
  };
}

export function buildAnimationRenderManifestV2(args: BuildAnimationRenderManifestArgs): AnimationRenderManifestV2 {
  if (args.tasks.length === 0) {
    throw new Error("Cannot build animation render manifest: tasks list is empty.");
  }
  if (args.tasks.length !== args.frameCount) {
    throw new Error(
      `Cannot build animation render manifest: expected ${args.frameCount} tasks, got ${args.tasks.length}.`
    );
  }

  const baseBackend = cloneNativeBackendConfig(args.tasks[0].snapshot.nativeBackend);
  let previousBackend = baseBackend;
  const frames: NativeRenderManifestFrame[] = [];

  for (const task of args.tasks) {
    const currentBackend = task.snapshot.nativeBackend;
    if (currentBackend.width !== baseBackend.width || currentBackend.height !== baseBackend.height) {
      throw new Error("Cannot build animation render manifest: native backend resolution changed between frames.");
    }
    if (currentBackend.maxSubframes !== baseBackend.maxSubframes) {
      throw new Error("Cannot build animation render manifest: maxSubframes changed between frames.");
    }
    if (
      currentBackend.sceneVertexShader !== baseBackend.sceneVertexShader ||
      currentBackend.sceneFragmentShader !== baseBackend.sceneFragmentShader
    ) {
      throw new Error("Cannot build animation render manifest: scene shader sources changed between frames.");
    }

    const sceneUniformValues = buildUniformDeltaMap(
      previousBackend.sceneUniforms,
      currentBackend.sceneUniforms,
      `frame ${task.frameIndex} sceneUniforms`
    );
    const displayUniformValues = buildUniformDeltaMap(
      previousBackend.displayUniforms,
      currentBackend.displayUniforms,
      `frame ${task.frameIndex} displayUniforms`
    );

    const delta: NativeBackendFrameDelta = {};
    if (currentBackend.timeSeconds !== previousBackend.timeSeconds) {
      delta.timeSeconds = currentBackend.timeSeconds;
    }
    if (currentBackend.frameSeedStart !== previousBackend.frameSeedStart) {
      delta.frameSeedStart = currentBackend.frameSeedStart;
    }
    if (Object.keys(sceneUniformValues).length > 0) {
      delta.sceneUniformValues = sceneUniformValues;
    }
    if (Object.keys(displayUniformValues).length > 0) {
      delta.displayUniformValues = displayUniformValues;
    }

    frames.push({
      frameIndex: task.frameIndex,
      timelineT: task.timelineT,
      seconds: task.seconds,
      outputPath: task.outputPath,
      nativeBackendDelta: delta
    });
    previousBackend = cloneNativeBackendConfig(currentBackend);
  }

  return {
    format: "fragmentarium-web-animation-render-manifest-v2",
    version: 2,
    appVersion: args.appVersion,
    createdAtMs: args.createdAtMs,
    source: {
      treePath: args.source.treePath,
      sourcePath: args.source.sourcePath,
      selectedSystemKey: args.source.selectedSystemKey
    },
    width: args.width,
    height: args.height,
    frameCount: args.frameCount,
    fps: args.fps,
    durationSeconds: args.durationSeconds,
    subframes: args.subframes,
    interpolation: args.interpolation,
    baseTask: {
      snapshot: {
        nativeBackend: baseBackend
      }
    },
    frames
  };
}
