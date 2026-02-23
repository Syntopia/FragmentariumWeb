import type { IntegratorDefinition } from "../integrators/types";
import type { SourceLineRef } from "../parser/types";

export interface SceneShaderBuildOptions {
  geometrySource: string;
  geometryLineMap?: Array<SourceLineRef | null>;
  integrator: IntegratorDefinition;
}

export interface FocusProbeShaderBuildOptions {
  geometrySource: string;
  geometryLineMap?: Array<SourceLineRef | null>;
}

export interface SceneShaderSources {
  vertexSource: string;
  fragmentSource: string;
  fragmentLineMap?: Array<SourceLineRef | null>;
}

export interface DisplayShaderSources {
  vertexSource: string;
  fragmentSource: string;
}

function lineCount(source: string): number {
  return source.length === 0 ? 1 : source.split(/\r\n|\r|\n/).length;
}

function buildFragmentLineMap(
  fragmentSource: string,
  geometrySource: string,
  geometryLineMap: Array<SourceLineRef | null> | undefined
): Array<SourceLineRef | null> | undefined {
  if (geometryLineMap === undefined || geometryLineMap.length === 0) {
    return undefined;
  }
  const geometryIndex = fragmentSource.indexOf(geometrySource);
  if (geometryIndex < 0) {
    return undefined;
  }
  const startLine = lineCount(fragmentSource.slice(0, geometryIndex));
  const finalLineCount = lineCount(fragmentSource);
  const mapped = Array.from({ length: finalLineCount }, () => null as SourceLineRef | null);
  const maxLines = Math.min(geometryLineMap.length, finalLineCount - (startLine - 1));
  for (let i = 0; i < maxLines; i += 1) {
    mapped[startLine - 1 + i] = geometryLineMap[i] ?? null;
  }
  return mapped;
}

const sceneMathPrelude = `
#ifndef PI
#define PI 3.14159265358979323846264
#endif
#ifndef TWO_PI
#define TWO_PI (2.0 * PI)
#endif
#ifndef HALF_PI
#define HALF_PI (0.5 * PI)
#endif
`;

const sceneMathPostlude = `
#ifdef HALF_PI
#undef HALF_PI
#endif
#ifdef TWO_PI
#undef TWO_PI
#endif
#ifdef PI
#undef PI
#endif
`;

const fullScreenTriangleVertexShader = `#version 300 es
precision highp float;

const vec2 positions[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vUv;

void main() {
  vec2 pos = positions[gl_VertexID];
  vUv = 0.5 * (pos + 1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const displayFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFrontbuffer;
uniform float uGamma;
uniform float uExposure;
uniform int uToneMapping;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;

vec3 contrastSaturationBrightness(vec3 color, float brt, float sat, float con) {
  const vec3 lumCoeff = vec3(0.2126, 0.7152, 0.0722);
  vec3 avgLum = vec3(0.5);
  vec3 brtColor = color * brt;
  float intensity = dot(brtColor, lumCoeff);
  vec3 satColor = mix(vec3(intensity), brtColor, sat);
  return mix(avgLum, satColor, con);
}

vec3 toneMapAcesFitted(vec3 color) {
  // Narkowicz ACES fitted curve (ACES-like, compact realtime approximation)
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  vec3 mapped = (color * (a * color + b)) / (color * (c * color + d) + e);
  return clamp(mapped, 0.0, 1.0);
}

vec3 toneMap(vec3 color) {
  vec3 c = max(color, vec3(0.0));

  if (uToneMapping == 1) {
    c = c * uExposure;
  } else if (uToneMapping == 2) {
    c = vec3(1.0) - exp(-c * uExposure);
  } else if (uToneMapping == 3) {
    c = toneMapAcesFitted(c * uExposure);
  } else {
    c *= uExposure;
    c = c / (vec3(1.0) + c);
  }

  c = contrastSaturationBrightness(c, uBrightness, uSaturation, uContrast);
  return pow(max(c, vec3(0.0)), vec3(1.0 / max(uGamma, 1.0e-4)));
}

void main() {
  vec4 accum = texture(uFrontbuffer, vUv);
  vec3 color = accum.rgb / max(accum.a, 1.0e-6);
  fragColor = vec4(toneMap(color), 1.0);
}
`;

function hasBaseColorFunction(source: string): boolean {
  return /\bvec3\s+baseColor\s*\(/.test(source);
}

function hasDistanceEstimator(source: string): boolean {
  return /\bfloat\s+DE\s*\(/.test(source);
}

function hasInitFunctionDefinition(source: string): boolean {
  return /\bvoid\s+init\s*\(\s*\)\s*\{/.test(source);
}

function hasOrbitTrapDeclaration(source: string): boolean {
  return /\bvec4\s+orbitTrap\b/.test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasUniformDeclaration(source: string, uniformName: string): boolean {
  const escapedName = escapeRegExp(uniformName);
  return new RegExp(`\\buniform\\s+[A-Za-z_][A-Za-z0-9_]*\\s+${escapedName}\\b`).test(source);
}

function buildCameraApertureResolver(hasApertureUniform: boolean): string {
  if (hasApertureUniform) {
    return `
float fragmentariumWebCameraAperture() {
  return max(Aperture, 0.0);
}
`;
  }

  return `
float fragmentariumWebCameraAperture() {
  return max(uLensAperture, 0.0);
}
`;
}

function buildCameraFocalDistanceResolver(hasFocalPlaneUniform: boolean): string {
  if (hasFocalPlaneUniform) {
    return `
float fragmentariumWebCameraFocalDistance() {
  return max(FocalPlane, 1.0e-4);
}
`;
  }

  return `
float fragmentariumWebCameraFocalDistance() {
  return max(uLensFocalDistance, 1.0e-4);
}
`;
}

function buildFragmentariumBridge(options: { hasOrbitTrap: boolean }): string {
  const clipHelpers = `
float fragmentariumWebSlicePlaneSignedDistance(vec3 p) {
  vec3 nRaw = uSlicePlaneResolvedNormal;
  float nLen = length(nRaw);
  vec3 n = nLen > 1.0e-6 ? (nRaw / nLen) : vec3(0.0, 0.0, 1.0);
  return dot(p - uSlicePlaneResolvedPoint, n);
}

float fragmentariumWebApplySlicePlaneCSG(vec3 p, float deValue) {
  if (uIntegrator_slicePlaneEnabled <= 0) {
    return deValue;
  }
  float sd = fragmentariumWebSlicePlaneSignedDistance(p);
  float keepHalfSpaceSdf = uIntegrator_slicePlaneKeepFarSide > 0 ? -sd : sd;
  return max(deValue, keepHalfSpaceSdf);
}
`;

  if (!options.hasOrbitTrap) {
    return `
${clipHelpers}
float fragmentariumWebDETrace(vec3 p) {
  return fragmentariumWebApplySlicePlaneCSG(p, DE(p));
}

float fragmentariumWebDESample(vec3 p) {
  return fragmentariumWebApplySlicePlaneCSG(p, DE(p));
}

float fragmentariumWebOrbitTrapValue(float falloff) {
  return 0.0;
}

vec3 fragmentariumResolveBaseColor(vec3 p, vec3 n) {
  return baseColor(p, n);
}
`;
  }

  return `
${clipHelpers}
vec4 fragmentariumWebCapturedOrbitTrap = vec4(10000.0);

void fragmentariumWebResetOrbitTrap() {
  orbitTrap = vec4(10000.0);
}

float fragmentariumWebDETrace(vec3 p) {
  fragmentariumWebResetOrbitTrap();
  float d = DE(p);
  fragmentariumWebCapturedOrbitTrap = orbitTrap;
  return fragmentariumWebApplySlicePlaneCSG(p, d);
}

float fragmentariumWebDESample(vec3 p) {
  vec4 savedTrap = fragmentariumWebCapturedOrbitTrap;
  fragmentariumWebResetOrbitTrap();
  float d = DE(p);
  orbitTrap = savedTrap;
  fragmentariumWebCapturedOrbitTrap = savedTrap;
  return fragmentariumWebApplySlicePlaneCSG(p, d);
}

float fragmentariumWebOrbitTrapValue(float falloff) {
  vec4 trap = abs(fragmentariumWebCapturedOrbitTrap);
  float trapRadius = sqrt(max(trap.w, 0.0));
  float trapMin = min(min(trap.x, trap.y), min(trap.z, trapRadius));
  float k = max(falloff, 1.0e-4);
  return clamp(exp(-trapMin * k), 0.0, 1.0);
}

void fragmentariumWebRestoreCapturedOrbitTrap() {
  orbitTrap = fragmentariumWebCapturedOrbitTrap;
}

vec3 fragmentariumResolveBaseColor(vec3 p, vec3 n) {
  fragmentariumWebRestoreCapturedOrbitTrap();
  return baseColor(p, n);
}
`;
}

export function buildSceneShaderSources(options: SceneShaderBuildOptions): SceneShaderSources {
  if (!hasDistanceEstimator(options.geometrySource)) {
    throw new Error("Geometry source must define a DE(vec3) function.");
  }

  const hasBaseColor = hasBaseColorFunction(options.geometrySource);
  const hasOrbitTrap = hasOrbitTrapDeclaration(options.geometrySource);
  const hasApertureUniform = hasUniformDeclaration(options.geometrySource, "Aperture");
  const hasFocalPlaneUniform = hasUniformDeclaration(options.geometrySource, "FocalPlane");

  const fallbackBaseColor = hasBaseColor
    ? ""
    : `\nvec3 baseColor(vec3 p, vec3 n) {\n  return vec3(0.85, 0.9, 1.0);\n}\n`;
  const hasInit = hasInitFunctionDefinition(options.geometrySource);
  const initInvocation = hasInit
    ? "  // Legacy Fragmentarium systems often require init() to update globals from uniforms.\n  init();\n"
    : "";
  const fragmentariumBridge = buildFragmentariumBridge({ hasOrbitTrap });
  const apertureResolver = buildCameraApertureResolver(hasApertureUniform);
  const focalDistanceResolver = buildCameraFocalDistanceResolver(hasFocalPlaneUniform);

  const fragmentSource = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uPixelOffset;
uniform float uTime;
uniform int uSubframe;
uniform int uFrameIndex;
uniform sampler2D uBackbuffer;
uniform bool uUseBackbuffer;

uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec3 uUp;
uniform float uFov;
uniform float uLensAperture;
uniform float uLensFocalDistance;
uniform float uAAStrength;
uniform int uIntegrator_slicePlaneEnabled;
uniform int uIntegrator_slicePlaneKeepFarSide;
uniform vec3 uSlicePlaneResolvedPoint;
uniform vec3 uSlicePlaneResolvedNormal;

float DE(vec3 p);
vec3 baseColor(vec3 p, vec3 n);

${sceneMathPrelude}
${options.geometrySource}
${fallbackBaseColor}
${sceneMathPostlude}
${fragmentariumBridge}
${options.integrator.glsl}

#ifndef HAS_FRAGMENTARIUM_WEB_INIT_GLOBALS
void fragmentariumWebInitGlobalsImpl() {}
#endif

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 fragmentariumWebSampleDisk(vec2 p) {
  float u1 = hash12(p + 11.17);
  float u2 = hash12(p + 47.31);
  float r = sqrt(u1);
  float theta = 6.283185307179586 * u2;
  return vec2(cos(theta), sin(theta)) * r;
}

#ifdef FRAGMENTARIUM_WEB_HAS_PCG_RNG
vec2 fragmentariumWebSampleDiskRng(inout uint rngState) {
  float u1 = rand(rngState);
  float u2 = rand(rngState);
  float r = sqrt(u1);
  float theta = 6.283185307179586 * u2;
  return vec2(cos(theta), sin(theta)) * r;
}
#endif
${apertureResolver}
${focalDistanceResolver}
void cameraRay(vec2 fragCoord, out vec3 rayOrigin, out vec3 rayDir) {
  vec2 pixelCoord = fragCoord + uPixelOffset;
  vec2 uv = pixelCoord / uResolution;
  uv = uv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  float frameSeed = float(uFrameIndex);
  vec2 jitter =
    (vec2(
      hash12(pixelCoord + vec2(3.0, 19.0) + vec2(frameSeed * 0.6180339, frameSeed * 0.4142135) + float(uSubframe)),
      hash12(pixelCoord + vec2(47.0, 7.0) + vec2(frameSeed * 0.1415927, frameSeed * 0.7320508) + float(uSubframe))
    ) - 0.5) *
    clamp(uAAStrength, 0.0, 2.0);
  jitter /= max(uResolution, vec2(1.0));

  vec3 viewDirRaw = uTarget - uEye;
  vec3 dir = normalize(length(viewDirRaw) > 1.0e-6 ? viewDirRaw : vec3(0.0, 0.0, 1.0));
  vec3 upOrtho = normalize(uUp - dot(uUp, dir) * dir);
  vec3 right = normalize(cross(dir, upOrtho));

  vec2 cameraCoord = (uv + jitter) * uFov;
  vec3 pinholeDir = normalize(dir + right * cameraCoord.x + upOrtho * cameraCoord.y);

  float aperture = fragmentariumWebCameraAperture();
  float focalDistance = fragmentariumWebCameraFocalDistance();
  if (aperture > 1.0e-6) {
#ifdef FRAGMENTARIUM_WEB_HAS_PCG_RNG
    uint lensRng = fragmentariumWebRngInit(pixelCoord, uSubframe, uFrameIndex + 7919);
    vec2 lens = fragmentariumWebSampleDiskRng(lensRng) * aperture;
#else
    vec2 lens = fragmentariumWebSampleDisk(
      pixelCoord + vec2(71.13, 29.47) * (float(uSubframe + 1) + frameSeed * 0.5)
    ) * aperture;
#endif
    vec3 lensOffset = right * lens.x + upOrtho * lens.y;
    vec3 focusPoint = uEye + pinholeDir * focalDistance;
    rayOrigin = uEye + lensOffset;
    rayDir = normalize(focusPoint - rayOrigin);
    return;
  }

  rayOrigin = uEye;
  rayDir = pinholeDir;
}

void main() {
  fragmentariumWebInitGlobalsImpl();
${initInvocation}  vec3 rayOrigin;
  vec3 rayDir;
  cameraRay(gl_FragCoord.xy, rayOrigin, rayDir);
  vec3 sampleColor = renderColor(rayOrigin, rayDir);

  if (uUseBackbuffer) {
    vec4 prev = texelFetch(uBackbuffer, ivec2(gl_FragCoord.xy), 0);
    fragColor = prev + vec4(sampleColor, 1.0);
  } else {
    fragColor = vec4(sampleColor, 1.0);
  }
}
`;

  return {
    vertexSource: fullScreenTriangleVertexShader,
    fragmentSource,
    fragmentLineMap: buildFragmentLineMap(fragmentSource, options.geometrySource, options.geometryLineMap)
  };
}

export function buildFocusProbeShaderSources(options: FocusProbeShaderBuildOptions): SceneShaderSources {
  if (!hasDistanceEstimator(options.geometrySource)) {
    throw new Error("Geometry source must define a DE(vec3) function.");
  }

  const hasBaseColor = hasBaseColorFunction(options.geometrySource);
  const hasOrbitTrap = hasOrbitTrapDeclaration(options.geometrySource);
  const fallbackBaseColor = hasBaseColor
    ? ""
    : `\nvec3 baseColor(vec3 p, vec3 n) {\n  return vec3(0.85, 0.9, 1.0);\n}\n`;
  const hasInit = hasInitFunctionDefinition(options.geometrySource);
  const initInvocation = hasInit
    ? "  // Legacy Fragmentarium systems often require init() to update globals from uniforms.\n  init();\n"
    : "";
  const fragmentariumBridge = buildFragmentariumBridge({ hasOrbitTrap });

  const fragmentSource = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec3 uUp;
uniform float uFov;
uniform vec2 uFocusUv;
uniform vec2 uViewportSize;
uniform float uDetailExp;
uniform int uMaxRaySteps;
uniform float uMaxDistance;
uniform float uFudgeFactor;
uniform int uIntegrator_slicePlaneEnabled;
uniform int uIntegrator_slicePlaneKeepFarSide;
uniform vec3 uSlicePlaneResolvedPoint;
uniform vec3 uSlicePlaneResolvedNormal;

float DE(vec3 p);
vec3 baseColor(vec3 p, vec3 n);

${sceneMathPrelude}
${options.geometrySource}
${fallbackBaseColor}
${sceneMathPostlude}
${fragmentariumBridge}

#ifndef HAS_FRAGMENTARIUM_WEB_INIT_GLOBALS
void fragmentariumWebInitGlobalsImpl() {}
#endif

const int FRAGMENTARIUM_WEB_MAX_FOCUS_STEPS = 1536;

float fragmentariumWebFocusEpsilon(float detailExp, float t) {
  float eps = max(pow(10.0, detailExp), 1.0e-6);
  return max(eps, eps * 0.01 * t);
}

float fragmentariumWebTraceFocusDistance(vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < FRAGMENTARIUM_WEB_MAX_FOCUS_STEPS; i++) {
    if (i >= uMaxRaySteps) {
      break;
    }
    vec3 p = ro + rd * t;
    float eps = fragmentariumWebFocusEpsilon(uDetailExp, t);
    float d = fragmentariumWebDETrace(p) * uFudgeFactor;
    if (d < eps) {
      return t;
    }
    t += d;
    if (t > uMaxDistance) {
      break;
    }
  }
  return -1.0;
}

void main() {
  fragmentariumWebInitGlobalsImpl();
${initInvocation}  vec2 focusUv = clamp(uFocusUv, vec2(0.0), vec2(1.0));
  vec2 uv = focusUv * 2.0 - 1.0;
  uv.x *= uViewportSize.x / max(uViewportSize.y, 1.0);

  vec3 dirRaw = uTarget - uEye;
  vec3 dir = normalize(length(dirRaw) > 1.0e-6 ? dirRaw : vec3(0.0, 0.0, 1.0));
  vec3 upOrtho = uUp - dot(uUp, dir) * dir;
  if (length(upOrtho) <= 1.0e-6) {
    upOrtho = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    upOrtho = normalize(upOrtho - dot(upOrtho, dir) * dir);
  } else {
    upOrtho = normalize(upOrtho);
  }
  vec3 right = normalize(cross(dir, upOrtho));
  vec2 cameraCoord = uv * uFov;
  vec3 rd = normalize(dir + right * cameraCoord.x + upOrtho * cameraCoord.y);
  float hitDistance = fragmentariumWebTraceFocusDistance(uEye, rd);
  fragColor = vec4(hitDistance, 0.0, 0.0, 1.0);
}
`;

  return {
    vertexSource: fullScreenTriangleVertexShader,
    fragmentSource,
    fragmentLineMap: buildFragmentLineMap(fragmentSource, options.geometrySource, options.geometryLineMap)
  };
}

export function buildDisplayShaderSources(): DisplayShaderSources {
  return {
    vertexSource: fullScreenTriangleVertexShader,
    fragmentSource: displayFragmentShader
  };
}
