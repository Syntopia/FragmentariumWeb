import type { IntegratorDefinition } from "../integrators/types";

export interface SceneShaderBuildOptions {
  geometrySource: string;
  integrator: IntegratorDefinition;
}

export interface SceneShaderSources {
  vertexSource: string;
  fragmentSource: string;
}

export interface DisplayShaderSources {
  vertexSource: string;
  fragmentSource: string;
}

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

export function buildSceneShaderSources(options: SceneShaderBuildOptions): SceneShaderSources {
  if (!hasDistanceEstimator(options.geometrySource)) {
    throw new Error("Geometry source must define a DE(vec3) function.");
  }

  const fallbackBaseColor = hasBaseColorFunction(options.geometrySource)
    ? ""
    : `\nvec3 baseColor(vec3 p, vec3 n) {\n  return vec3(0.85, 0.9, 1.0);\n}\n`;

  const fragmentSource = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform int uSubframe;
uniform sampler2D uBackbuffer;
uniform bool uUseBackbuffer;

uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec3 uUp;
uniform float uFov;

${options.geometrySource}
${fallbackBaseColor}
${options.integrator.glsl}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 cameraRay(vec2 fragCoord) {
  vec2 uv = fragCoord / uResolution;
  uv = uv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  vec2 jitter = vec2(0.0);
  if (uSubframe > 0) {
    jitter = vec2(hash12(fragCoord + float(uSubframe)), hash12(fragCoord + 17.0 + float(uSubframe))) - 0.5;
    jitter /= uResolution;
  }

  vec3 dir = normalize(uTarget - uEye);
  vec3 upOrtho = normalize(uUp - dot(uUp, dir) * dir);
  vec3 right = normalize(cross(dir, upOrtho));

  vec2 cameraCoord = (uv + jitter) * uFov;
  return normalize(dir + right * cameraCoord.x + upOrtho * cameraCoord.y);
}

void main() {
  vec3 rayDir = cameraRay(gl_FragCoord.xy);
  vec3 sampleColor = renderColor(uEye, rayDir);

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
    fragmentSource
  };
}

export function buildDisplayShaderSources(): DisplayShaderSources {
  return {
    vertexSource: fullScreenTriangleVertexShader,
    fragmentSource: displayFragmentShader
  };
}
