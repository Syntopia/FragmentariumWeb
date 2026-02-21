import type { IntegratorDefinition, IntegratorOptionDefinition, IntegratorOptionValues } from "./types";

const deFastRaymarchGlsl = `
uniform float uIntegrator_detailExp;
uniform float uIntegrator_detailAOExp;
uniform int uIntegrator_maxRaySteps;
uniform int uIntegrator_maxDistance;
uniform float uIntegrator_fudgeFactor;
uniform float uIntegrator_aoStrength;
uniform int uIntegrator_aoSamples;
uniform float uIntegrator_shadowStrength;
uniform float uIntegrator_fog;
uniform float uIntegrator_backgroundStrength;

const int MAX_TRACE_STEPS = 1024;
const int MAX_AO_SAMPLES = 8;

float baseEpsilon() {
  return max(pow(10.0, uIntegrator_detailExp), 1.0e-6);
}

float hitEpsilon(float t) {
  float eps = baseEpsilon();
  return max(eps, eps * 0.01 * t);
}

vec3 estimateNormalDE(vec3 p, float t) {
  float e = max(hitEpsilon(t) * 0.5, 1.0e-6);
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * fragmentariumWebDESample(p + k.xyy * e) +
    k.yyx * fragmentariumWebDESample(p + k.yyx * e) +
    k.yxy * fragmentariumWebDESample(p + k.yxy * e) +
    k.xxx * fragmentariumWebDESample(p + k.xxx * e)
  );
}

bool tracePrimary(vec3 ro, vec3 rd, out float hitT) {
  float t = 0.0;

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= uIntegrator_maxRaySteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float eps = hitEpsilon(t);
    float d = fragmentariumWebDETrace(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      hitT = t;
      return true;
    }

    t += d;
    if (t > float(uIntegrator_maxDistance)) {
      break;
    }
  }

  hitT = t;
  return false;
}

float traceShadow(vec3 ro, vec3 rd, float startT) {
  float t = startT;
  float visibility = 1.0;
  int shadowSteps = max(8, uIntegrator_maxRaySteps / 2);

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= shadowSteps) {
      break;
    }
    vec3 p = ro + rd * t;
    float eps = hitEpsilon(t);
    float d = fragmentariumWebDESample(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      return 0.0;
    }
    visibility = min(visibility, 12.0 * d / max(t, 1.0e-5));
    t += max(d, eps * 0.5);
    if (t > float(uIntegrator_maxDistance)) {
      break;
    }
  }
  return clamp(visibility, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  int sampleCount = clamp(uIntegrator_aoSamples, 0, MAX_AO_SAMPLES);
  if (sampleCount <= 0 || uIntegrator_aoStrength <= 0.0) {
    return 1.0;
  }

  float baseStep = max(pow(10.0, uIntegrator_detailAOExp), 1.0e-6);
  float ao = 0.0;
  float weight = 1.0;

  for (int i = 1; i <= MAX_AO_SAMPLES; i++) {
    if (i > sampleCount) {
      break;
    }
    float d = float(i) * float(i) * baseStep;
    float distanceSample = fragmentariumWebDESample(p + n * d);
    ao += (d - distanceSample) * weight;
    weight *= 0.65;
  }
  return clamp(1.0 - ao * uIntegrator_aoStrength, 0.0, 1.0);
}

vec3 backgroundColor(vec3 rd) {
  float gradient = clamp(0.5 + 0.5 * rd.y, 0.0, 1.0);
  vec3 bg = mix(vec3(0.06, 0.07, 0.08), vec3(0.3, 0.35, 0.42), gradient);
  return bg * (0.4 + uIntegrator_backgroundStrength);
}

vec3 renderColor(vec3 ro, vec3 rd) {
  float t = 0.0;
  bool hit = tracePrimary(ro, rd, t);
  vec3 bg = backgroundColor(rd);
  if (!hit) {
    return bg;
  }

  vec3 p = ro + rd * t;
  float eps = hitEpsilon(t);
  vec3 n = estimateNormalDE(p, t);
  vec3 base = fragmentariumResolveBaseColor(p, n);
  vec3 sunDir = normalize(vec3(0.6, 0.7, 0.2));
  vec3 fillDir = normalize(vec3(-0.4, 0.4, -0.5));

  float ao = ambientOcclusion(p, n);
  float shadow = traceShadow(p + n * eps * 2.0, sunDir, eps * 4.0);
  float diffuseSun = max(dot(n, sunDir), 0.0);
  float diffuseFill = max(dot(n, fillDir), 0.0);

  float adjustedShadow = mix(1.0, shadow, clamp(uIntegrator_shadowStrength, 0.0, 1.0));
  vec3 lit = base * (0.12 + 0.95 * diffuseSun * adjustedShadow + 0.25 * diffuseFill);

  vec3 h = normalize(sunDir - rd);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.5 * adjustedShadow;
  lit += vec3(spec);

  lit *= ao;

  float fogDensity = uIntegrator_fog * uIntegrator_fog * 0.0015;
  float fogFactor = 1.0 - exp(-fogDensity * t * t);
  return mix(lit, bg, clamp(fogFactor, 0.0, 1.0));
}
`;

const deFastOptionTemplate: IntegratorOptionDefinition[] = [
  { key: "detailExp", label: "Detail", min: -7, max: 0, defaultValue: -2.3, step: 0.01 },
  { key: "detailAOExp", label: "Detail AO", min: -7, max: 0, defaultValue: -1, step: 0.01 },
  { key: "maxRaySteps", label: "Max Steps", min: 16, max: 1024, defaultValue: 192, step: 1 },
  { key: "maxDistance", label: "Max Distance", min: 50, max: 4000, defaultValue: 1200, step: 1 },
  { key: "fudgeFactor", label: "Fudge Factor", min: 0.25, max: 2, defaultValue: 1, step: 0.01 },
  { key: "aoStrength", label: "AO Strength", min: 0, max: 2, defaultValue: 0.7, step: 0.01 },
  { key: "aoSamples", label: "AO Samples", min: 0, max: 8, defaultValue: 5, step: 1 },
  { key: "shadowStrength", label: "Shadow Strength", min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
  { key: "fog", label: "Fog", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
  { key: "backgroundStrength", label: "Background", min: 0, max: 1, defaultValue: 0.2, step: 0.01 },
  { key: "aperture", label: "Aperture", min: 0, max: 0.2, defaultValue: 0, step: 0.0001 },
  { key: "focalDistance", label: "Focal Dist", min: 0.05, max: 4000, defaultValue: 6, step: 0.01 },
  { key: "aaJitter", label: "AA Jitter", min: 0, max: 2, defaultValue: 1, step: 0.01 }
];

function buildFastOptions(defaultOverrides: Record<string, number>): IntegratorOptionDefinition[] {
  return deFastOptionTemplate.map((option) => ({
    ...option,
    defaultValue: defaultOverrides[option.key] ?? option.defaultValue
  }));
}

const deQualityRaytracerPbrGlsl = `
uniform float uIntegrator_detailExp;
uniform float uIntegrator_detailAOExp;
uniform int uIntegrator_maxRaySteps;
uniform int uIntegrator_maxDistance;
uniform float uIntegrator_fudgeFactor;
uniform float uIntegrator_aoStrength;
uniform int uIntegrator_aoSamples;
uniform float uIntegrator_shadowStrength;
uniform float uIntegrator_fog;
uniform float uIntegrator_backgroundStrength;

uniform float uIntegrator_diffuseColorR;
uniform float uIntegrator_diffuseColorG;
uniform float uIntegrator_diffuseColorB;
uniform int uIntegrator_useOrbitTrap;
uniform float uIntegrator_orbitTrapFalloff;
uniform float uIntegrator_metalness;
uniform float uIntegrator_roughness;
uniform float uIntegrator_sunStrength;
uniform float uIntegrator_ambientStrength;
uniform float uIntegrator_specularStrength;

const int MAX_TRACE_STEPS = 1024;
const int MAX_AO_SAMPLES = 8;
const float PI_SURFACE = 3.141592653589793;

float baseEpsilon() {
  return max(pow(10.0, uIntegrator_detailExp), 1.0e-6);
}

float hitEpsilon(float t) {
  float eps = baseEpsilon();
  return max(eps, eps * 0.01 * t);
}

vec3 estimateNormalDE(vec3 p, float t) {
  float e = max(hitEpsilon(t) * 0.5, 1.0e-6);
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * fragmentariumWebDESample(p + k.xyy * e) +
    k.yyx * fragmentariumWebDESample(p + k.yyx * e) +
    k.yxy * fragmentariumWebDESample(p + k.yxy * e) +
    k.xxx * fragmentariumWebDESample(p + k.xxx * e)
  );
}

bool tracePrimary(vec3 ro, vec3 rd, out float hitT) {
  float t = 0.0;

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= uIntegrator_maxRaySteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float eps = hitEpsilon(t);
    float d = fragmentariumWebDETrace(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      hitT = t;
      return true;
    }

    t += d;
    if (t > float(uIntegrator_maxDistance)) {
      break;
    }
  }

  hitT = t;
  return false;
}

float traceShadow(vec3 ro, vec3 rd, float startT) {
  float t = startT;
  float visibility = 1.0;
  int shadowSteps = max(8, uIntegrator_maxRaySteps / 2);

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= shadowSteps) {
      break;
    }
    vec3 p = ro + rd * t;
    float eps = hitEpsilon(t);
    float d = fragmentariumWebDESample(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      return 0.0;
    }
    visibility = min(visibility, 12.0 * d / max(t, 1.0e-5));
    t += max(d, eps * 0.5);
    if (t > float(uIntegrator_maxDistance)) {
      break;
    }
  }
  return clamp(visibility, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  int sampleCount = clamp(uIntegrator_aoSamples, 0, MAX_AO_SAMPLES);
  if (sampleCount <= 0 || uIntegrator_aoStrength <= 0.0) {
    return 1.0;
  }

  float baseStep = max(pow(10.0, uIntegrator_detailAOExp), 1.0e-6);
  float ao = 0.0;
  float weight = 1.0;

  for (int i = 1; i <= MAX_AO_SAMPLES; i++) {
    if (i > sampleCount) {
      break;
    }
    float d = float(i) * float(i) * baseStep;
    float distanceSample = fragmentariumWebDESample(p + n * d);
    ao += (d - distanceSample) * weight;
    weight *= 0.65;
  }
  return clamp(1.0 - ao * uIntegrator_aoStrength, 0.0, 1.0);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 backgroundColor(vec3 rd) {
  float gradient = clamp(0.5 + 0.5 * rd.y, 0.0, 1.0);
  vec3 bg = mix(vec3(0.05, 0.06, 0.08), vec3(0.29, 0.34, 0.42), gradient);
  return bg * (0.35 + uIntegrator_backgroundStrength);
}

vec3 fresnelSchlick(float cosTheta, vec3 f0) {
  float t = clamp(1.0 - cosTheta, 0.0, 1.0);
  return f0 + (vec3(1.0) - f0) * (t * t * t * t * t);
}

float D_GGX(float nDotH, float alphaR) {
  float a2 = alphaR * alphaR;
  float denom = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI_SURFACE * denom * denom, 1.0e-6);
}

float G_SchlickGGX(float nDotX, float alphaR) {
  float rough = sqrt(max(alphaR, 1.0e-6));
  float k = (rough + 1.0);
  k = (k * k) * 0.125;
  return nDotX / max(nDotX * (1.0 - k) + k, 1.0e-6);
}

float G_Smith_SchlickGGX(float nDotV, float nDotL, float alphaR) {
  return G_SchlickGGX(nDotV, alphaR) * G_SchlickGGX(nDotL, alphaR);
}

vec3 materialBaseColor() {
  vec3 diffuseColor = clamp(
    vec3(uIntegrator_diffuseColorR, uIntegrator_diffuseColorG, uIntegrator_diffuseColorB),
    vec3(0.0),
    vec3(1.0)
  );

  if (uIntegrator_useOrbitTrap > 0) {
    float trapVal = fragmentariumWebOrbitTrapValue(uIntegrator_orbitTrapFalloff);
    vec3 trapHue = hsv2rgb(vec3(trapVal, 1.0, 1.0));
    diffuseColor = mix(diffuseColor, trapHue, trapVal);
  }

  return diffuseColor;
}

vec3 renderColor(vec3 ro, vec3 rd) {
  float t = 0.0;
  bool hit = tracePrimary(ro, rd, t);
  vec3 bg = backgroundColor(rd);
  if (!hit) {
    return bg;
  }

  vec3 p = ro + rd * t;
  float eps = hitEpsilon(t);
  vec3 n = estimateNormalDE(p, t);
  vec3 v = normalize(-rd);
  float nDotV = max(dot(n, v), 0.0);
  if (nDotV <= 1.0e-6) {
    return bg;
  }

  vec3 baseCol = materialBaseColor();
  float m = clamp(uIntegrator_metalness, 0.0, 1.0);
  float r = clamp(uIntegrator_roughness, 0.0, 1.0);
  float alphaR = max(1.0e-3, r * r);

  vec3 sunDir = normalize(vec3(0.6, 0.7, 0.2));
  vec3 sunRadiance = vec3(1.0, 0.97, 0.92) * uIntegrator_sunStrength;
  float nDotL = max(dot(n, sunDir), 0.0);
  float shadow = traceShadow(p + n * eps * 2.0, sunDir, eps * 4.0);
  float adjustedShadow = mix(1.0, shadow, clamp(uIntegrator_shadowStrength, 0.0, 1.0));

  vec3 F0 = mix(vec3(0.04), baseCol, m);
  vec3 direct = vec3(0.0);
  if (nDotL > 0.0) {
    vec3 h = normalize(v + sunDir);
    float nDotH = max(dot(n, h), 0.0);
    float vDotH = max(dot(v, h), 0.0);

    vec3 F = fresnelSchlick(vDotH, F0);
    float D = nDotH > 0.0 ? D_GGX(nDotH, alphaR) : 0.0;
    float G = G_Smith_SchlickGGX(nDotV, nDotL, alphaR);

    vec3 specularBRDF = (D * G) * F / max(1.0e-4, 4.0 * nDotV * nDotL);
    vec3 specular = specularBRDF * nDotL * uIntegrator_specularStrength;

    vec3 kD = (vec3(1.0) - F) * (1.0 - m);
    vec3 diffuse = kD * baseCol * (nDotL / PI_SURFACE);
    direct = (diffuse + specular) * sunRadiance * adjustedShadow;
  }

  float ao = ambientOcclusion(p, n);
  vec3 sky = mix(vec3(0.04, 0.05, 0.07), vec3(0.22, 0.28, 0.36), clamp(0.5 + 0.5 * n.y, 0.0, 1.0));
  vec3 F_ambient = fresnelSchlick(nDotV, F0);
  vec3 kDambient = (vec3(1.0) - F_ambient) * (1.0 - m);
  vec3 ambientDiffuse = kDambient * baseCol * sky * uIntegrator_ambientStrength;
  vec3 ambientSpecular = F_ambient * sky * uIntegrator_ambientStrength * mix(0.08, 0.35, 1.0 - r) * uIntegrator_specularStrength;

  vec3 lit = direct + (ambientDiffuse + ambientSpecular) * ao;

  float fogDensity = uIntegrator_fog * uIntegrator_fog * 0.0015;
  float fogFactor = 1.0 - exp(-fogDensity * t * t);
  return mix(lit, bg, clamp(fogFactor, 0.0, 1.0));
}
`;

const deQualityOptionTemplate: IntegratorOptionDefinition[] = [
  { key: "detailExp", label: "Detail", min: -7, max: 0, defaultValue: -2.3, step: 0.01 },
  { key: "detailAOExp", label: "Detail AO", min: -7, max: 0, defaultValue: -1, step: 0.01 },
  { key: "maxRaySteps", label: "Max Steps", min: 16, max: 1024, defaultValue: 220, step: 1 },
  { key: "maxDistance", label: "Max Distance", min: 50, max: 4000, defaultValue: 1200, step: 1 },
  { key: "fudgeFactor", label: "Fudge Factor", min: 0.25, max: 2, defaultValue: 1, step: 0.01 },
  { key: "aoStrength", label: "AO Strength", min: 0, max: 2, defaultValue: 0.55, step: 0.01 },
  { key: "aoSamples", label: "AO Samples", min: 0, max: 8, defaultValue: 5, step: 1 },
  { key: "shadowStrength", label: "Shadow Strength", min: 0, max: 1, defaultValue: 0.65, step: 0.01 },
  { key: "fog", label: "Fog", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
  { key: "backgroundStrength", label: "Background", min: 0, max: 1, defaultValue: 0.2, step: 0.01 },
  { key: "diffuseColorR", label: "Diffuse R", min: 0, max: 1, defaultValue: 0.9, step: 0.01 },
  { key: "diffuseColorG", label: "Diffuse G", min: 0, max: 1, defaultValue: 0.82, step: 0.01 },
  { key: "diffuseColorB", label: "Diffuse B", min: 0, max: 1, defaultValue: 0.72, step: 0.01 },
  { key: "useOrbitTrap", label: "Use Orbit Trap", min: 0, max: 1, defaultValue: 1, step: 1 },
  { key: "orbitTrapFalloff", label: "Trap Falloff", min: 0.1, max: 24, defaultValue: 5.5, step: 0.01 },
  { key: "metalness", label: "Metalness", min: 0, max: 1, defaultValue: 0.05, step: 0.01 },
  { key: "roughness", label: "Roughness", min: 0, max: 1, defaultValue: 0.35, step: 0.01 },
  { key: "aperture", label: "Aperture", min: 0, max: 0.2, defaultValue: 0, step: 0.0001 },
  { key: "focalDistance", label: "Focal Dist", min: 0.05, max: 4000, defaultValue: 6, step: 0.01 },
  { key: "aaJitter", label: "AA Jitter", min: 0, max: 2, defaultValue: 1, step: 0.01 },
  { key: "sunStrength", label: "Sun Strength", min: 0, max: 20, defaultValue: 4.5, step: 0.01 },
  { key: "ambientStrength", label: "Ambient", min: 0, max: 3, defaultValue: 0.8, step: 0.01 },
  { key: "specularStrength", label: "Specular", min: 0, max: 3, defaultValue: 1.0, step: 0.01 }
];

const dePathTracerPhysicalGlsl = `
uniform float uIntegrator_detailExp;
uniform int uIntegrator_maxRaySteps;
uniform float uIntegrator_fudgeFactor;
uniform int uIntegrator_bounceCount;
uniform float uIntegrator_albedo;
uniform float uIntegrator_roughness;
uniform float uIntegrator_metallic;
uniform float uIntegrator_reflectivity;
uniform int uIntegrator_useOrbitTrap;
uniform float uIntegrator_orbitTrapFalloff;
uniform int uIntegrator_directLight;
uniform float uIntegrator_sunStrength;
uniform float uIntegrator_skyStrength;
uniform float uIntegrator_sunAngularDiameterDeg;
uniform int uIntegrator_areaLightEnabled;
uniform float uIntegrator_areaLightIntensity;
uniform float uIntegrator_areaLightSize;
uniform float uIntegrator_areaLightOffsetX;
uniform float uIntegrator_areaLightOffsetY;
uniform float uIntegrator_areaLightOffsetZ;
uniform float uIntegrator_areaLightColorR;
uniform float uIntegrator_areaLightColorG;
uniform float uIntegrator_areaLightColorB;
uniform int uIntegrator_maxDistance;
uniform float uIntegrator_sampleClamp;

const int MAX_TRACE_STEPS = 1536;
const int MAX_BOUNCES = 16;
const float PI = 3.141592653589793;
const float INV_PI = 0.3183098861837907;

float minDistPTPhys() {
  return max(pow(10.0, uIntegrator_detailExp), 1.0e-6);
}

vec3 estimateNormalPTPhys(vec3 p) {
  float e = max(minDistPTPhys() * 0.5, 1.0e-6);
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * fragmentariumWebDESample(p + k.xyy * e) +
    k.yyx * fragmentariumWebDESample(p + k.yyx * e) +
    k.yxy * fragmentariumWebDESample(p + k.yxy * e) +
    k.xxx * fragmentariumWebDESample(p + k.xxx * e)
  );
}

uint fragmentariumWebRngInit(vec2 fragCoord, int subframe, int frameIndex) {
  uvec2 p = uvec2(uint(floor(fragCoord.x)), uint(floor(fragCoord.y)));
  uint seed = p.x * 1973u + p.y * 9277u + uint(subframe) * 26699u + uint(frameIndex) * 31847u + 89173u;
  seed ^= seed >> 16u;
  seed *= 2246822519u;
  seed ^= seed >> 13u;
  seed *= 3266489917u;
  seed ^= seed >> 16u;
  return seed;
}

float rand(inout uint state) {
  state = state * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  word = (word >> 22u) ^ word;
  return float(word) * (1.0 / 4294967295.0);
}

void buildBasis(vec3 n, out vec3 tangent, out vec3 bitangent) {
  vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  tangent = normalize(cross(up, n));
  bitangent = cross(n, tangent);
}

vec3 sampleCosineHemisphere(vec3 n, inout uint rng) {
  float r1 = rand(rng);
  float r2 = rand(rng);
  float phi = 2.0 * PI * r1;
  float r = sqrt(r2);
  float x = r * cos(phi);
  float y = r * sin(phi);
  float z = sqrt(max(0.0, 1.0 - r2));

  vec3 tangent;
  vec3 bitangent;
  buildBasis(n, tangent, bitangent);
  return normalize(tangent * x + bitangent * y + n * z);
}

vec3 sampleGGXHalfVector(vec3 n, float roughness, inout uint rng) {
  float alpha = max(0.02, roughness * roughness);
  float alpha2 = alpha * alpha;
  float u1 = rand(rng);
  float u2 = rand(rng);

  float phi = 2.0 * PI * u1;
  float cosTheta = sqrt((1.0 - u2) / max(1.0 + (alpha2 - 1.0) * u2, 1.0e-6));
  float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));

  vec3 hLocal = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
  vec3 tangent;
  vec3 bitangent;
  buildBasis(n, tangent, bitangent);
  return normalize(tangent * hLocal.x + bitangent * hLocal.y + n * hLocal.z);
}

float D_GGX(float nDotH, float roughness) {
  float alpha = max(0.02, roughness * roughness);
  float alpha2 = alpha * alpha;
  float denom = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(PI * denom * denom, 1.0e-7);
}

float G_SchlickGGX(float nDotX, float roughness) {
  float k = pow(roughness + 1.0, 2.0) * 0.125;
  return nDotX / max(nDotX * (1.0 - k) + k, 1.0e-6);
}

float G_Smith(float nDotV, float nDotL, float roughness) {
  return G_SchlickGGX(nDotV, roughness) * G_SchlickGGX(nDotL, roughness);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 fresnelSchlick(float cosTheta, vec3 f0) {
  return f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

float specularLobeProbability(vec3 f0, float roughness) {
  float base = max(max(f0.r, f0.g), f0.b);
  float glossBoost = 0.25 * (1.0 - clamp(roughness, 0.0, 1.0));
  return clamp(base * (1.0 + glossBoost), 0.0, 0.98);
}

void evaluateBSDF(
  vec3 n,
  vec3 v,
  vec3 l,
  vec3 base,
  float roughness,
  float metallic,
  float reflectivity,
  out vec3 f,
  out float pdf
) {
  float nDotV = max(dot(n, v), 0.0);
  float nDotL = max(dot(n, l), 0.0);
  if (nDotV <= 0.0 || nDotL <= 0.0) {
    f = vec3(0.0);
    pdf = 0.0;
    return;
  }

  vec3 h = normalize(v + l);
  float nDotH = max(dot(n, h), 0.0);
  float vDotH = max(dot(v, h), 0.0);

  float dielectricF0 = clamp(reflectivity, 0.0, 1.0) * 0.08;
  vec3 f0 = mix(vec3(dielectricF0), base, clamp(metallic, 0.0, 1.0));
  vec3 F = fresnelSchlick(vDotH, f0);
  float D = D_GGX(nDotH, roughness);
  float G = G_Smith(nDotV, nDotL, roughness);

  vec3 specular = (D * G * F) / max(4.0 * nDotV * nDotL, 1.0e-6);
  vec3 kd = (vec3(1.0) - F) * (1.0 - clamp(metallic, 0.0, 1.0));
  vec3 diffuse = kd * base * INV_PI;
  f = diffuse + specular;

  float pSpec = specularLobeProbability(f0, roughness);
  float pdfDiffuse = nDotL * INV_PI;
  float pdfSpec = (D * nDotH) / max(4.0 * vDotH, 1.0e-6);
  pdf = mix(pdfDiffuse, pdfSpec, pSpec);
}

bool traceDE(vec3 ro, vec3 rd, out vec3 hitPos, out vec3 hitNormal, out float hitT) {
  float t = 0.0;
  float eps = minDistPTPhys();
  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= uIntegrator_maxRaySteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float d = fragmentariumWebDETrace(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      hitPos = p;
      hitNormal = estimateNormalPTPhys(p);
      hitT = t;
      return true;
    }

    t += d;
    if (t > float(uIntegrator_maxDistance)) {
      break;
    }
  }

  hitPos = ro + rd * t;
  hitNormal = vec3(0.0, 1.0, 0.0);
  hitT = t;
  return false;
}

float traceVisibility(vec3 ro, vec3 rd, float maxDistance) {
  float t = minDistPTPhys() * 4.0;
  float eps = minDistPTPhys();
  int shadowSteps = max(8, uIntegrator_maxRaySteps / 3);

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= shadowSteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float d = fragmentariumWebDESample(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      return 0.0;
    }
    t += max(d, eps * 0.5);
    if (t > maxDistance) {
      return 1.0;
    }
  }

  return 1.0;
}

vec3 sunDirectionPT() {
  return normalize(vec3(0.6, 0.7, 0.2));
}

float sunCosThetaMaxPT() {
  float diameterRad = radians(clamp(uIntegrator_sunAngularDiameterDeg, 0.05, 5.0));
  float halfAngle = 0.5 * diameterRad;
  return cos(halfAngle);
}

vec3 skyRadiance(vec3 rd) {
  float gradient = clamp(0.5 + 0.5 * rd.y, 0.0, 1.0);
  return mix(vec3(0.03, 0.05, 0.08), vec3(0.3, 0.4, 0.55), gradient) * uIntegrator_skyStrength;
}

vec3 sunRadiance(vec3 rd) {
  float cosThetaMax = sunCosThetaMaxPT();
  float align = dot(normalize(rd), sunDirectionPT());
  if (align < cosThetaMax) {
    return vec3(0.0);
  }
  float sunOmega = 2.0 * PI * (1.0 - cosThetaMax);
  return vec3(1.0, 0.97, 0.93) * (uIntegrator_sunStrength / max(sunOmega, 1.0e-6));
}

vec3 sampleSunDirection(inout uint rng, out float pdf) {
  vec3 sunDir = sunDirectionPT();
  float cosThetaMax = sunCosThetaMaxPT();
  float u1 = rand(rng);
  float u2 = rand(rng);
  float cosTheta = mix(cosThetaMax, 1.0, u1);
  float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  float phi = 2.0 * PI * u2;

  vec3 tangent;
  vec3 bitangent;
  buildBasis(sunDir, tangent, bitangent);

  vec3 l = normalize(
    tangent * (cos(phi) * sinTheta) +
    bitangent * (sin(phi) * sinTheta) +
    sunDir * cosTheta
  );

  float omega = 2.0 * PI * (1.0 - cosThetaMax);
  pdf = 1.0 / max(omega, 1.0e-6);
  return l;
}

void cameraBasisPT(out vec3 dir, out vec3 right, out vec3 upOrtho) {
  vec3 viewDirRaw = uTarget - uEye;
  dir = normalize(length(viewDirRaw) > 1.0e-6 ? viewDirRaw : vec3(0.0, 0.0, 1.0));
  upOrtho = normalize(uUp - dot(uUp, dir) * dir);
  if (length(upOrtho) <= 1.0e-6) {
    upOrtho = vec3(0.0, 1.0, 0.0);
    if (abs(dot(upOrtho, dir)) > 0.99) {
      upOrtho = vec3(1.0, 0.0, 0.0);
    }
    upOrtho = normalize(upOrtho - dot(upOrtho, dir) * dir);
  }
  right = normalize(cross(dir, upOrtho));
}

vec3 areaLightRadiancePT() {
  vec3 color = clamp(
    vec3(uIntegrator_areaLightColorR, uIntegrator_areaLightColorG, uIntegrator_areaLightColorB),
    vec3(0.0),
    vec3(1.0)
  );
  return color * max(uIntegrator_areaLightIntensity, 0.0);
}

bool sampleAreaLightPointPT(
  inout uint rng,
  out vec3 lightPos,
  out vec3 lightNormal,
  out vec3 lightRadiance,
  out float pdfArea
) {
  lightPos = vec3(0.0);
  lightNormal = vec3(0.0, 0.0, 1.0);
  lightRadiance = vec3(0.0);
  pdfArea = 0.0;

  if (uIntegrator_areaLightEnabled <= 0) {
    return false;
  }

  lightRadiance = areaLightRadiancePT();
  if (max(max(lightRadiance.r, lightRadiance.g), lightRadiance.b) <= 1.0e-6) {
    return false;
  }

  float halfSize = max(uIntegrator_areaLightSize, 1.0e-4);

  vec3 dir;
  vec3 right;
  vec3 upOrtho;
  cameraBasisPT(dir, right, upOrtho);

  vec3 center = uEye +
    right * uIntegrator_areaLightOffsetX +
    upOrtho * uIntegrator_areaLightOffsetY +
    dir * uIntegrator_areaLightOffsetZ;

  float sx = mix(-halfSize, halfSize, rand(rng));
  float sy = mix(-halfSize, halfSize, rand(rng));
  lightPos = center + right * sx + upOrtho * sy;
  lightNormal = dir;

  float area = (2.0 * halfSize) * (2.0 * halfSize);
  pdfArea = 1.0 / max(area, 1.0e-6);
  return true;
}

float powerHeuristic(float a, float b) {
  float a2 = a * a;
  float b2 = b * b;
  return a2 / max(a2 + b2, 1.0e-6);
}

vec3 renderColor(vec3 ro, vec3 rd) {
  uint rng = fragmentariumWebRngInit(gl_FragCoord.xy, uSubframe, uFrameIndex);
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  vec3 origin = ro;
  vec3 direction = normalize(rd);

  for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    if (bounce >= uIntegrator_bounceCount) {
      break;
    }

    vec3 hitPos;
    vec3 hitNormal;
    float hitT;
    bool hit = traceDE(origin, direction, hitPos, hitNormal, hitT);
    if (!hit) {
      vec3 env = skyRadiance(direction);
      bool includeSun = (uIntegrator_directLight == 0) || (bounce == 0);
      if (includeSun) {
        env += sunRadiance(direction);
      }
      radiance += throughput * env;
      break;
    }

    vec3 n = hitNormal;
    vec3 v = normalize(-direction);
    vec3 base = clamp(fragmentariumResolveBaseColor(hitPos, n), vec3(0.0), vec3(1.0));
    if (uIntegrator_useOrbitTrap > 0) {
      float trapVal = fragmentariumWebOrbitTrapValue(uIntegrator_orbitTrapFalloff);
      vec3 trapHue = hsv2rgb(vec3(trapVal, 1.0, 1.0));
      base = mix(base, trapHue, trapVal);
    }
    float roughness = clamp(uIntegrator_roughness, 0.02, 1.0);
    float metallic = clamp(uIntegrator_metallic, 0.0, 1.0);
    float reflectivity = clamp(uIntegrator_reflectivity, 0.0, 1.0);

    if (uIntegrator_directLight > 0) {
      float pdfLight = 0.0;
      vec3 lSun = sampleSunDirection(rng, pdfLight);
      float nDotLSun = max(dot(n, lSun), 0.0);
      if (nDotLSun > 0.0) {
        float vis = traceVisibility(hitPos + n * minDistPTPhys() * 6.0, lSun, float(uIntegrator_maxDistance));
        if (vis > 0.0) {
          vec3 fSun;
          float pdfBsdfSun;
          evaluateBSDF(n, v, lSun, base, roughness, metallic, reflectivity, fSun, pdfBsdfSun);
          if (pdfLight > 0.0) {
            float w = powerHeuristic(pdfLight, pdfBsdfSun);
            radiance += throughput * fSun * nDotLSun * sunRadiance(lSun) * vis * (w / pdfLight);
          }
        }
      }

      vec3 lightPos;
      vec3 lightNormal;
      vec3 lightRadiance;
      float pdfArea;
      if (sampleAreaLightPointPT(rng, lightPos, lightNormal, lightRadiance, pdfArea)) {
        vec3 toLight = lightPos - hitPos;
        float distSq = dot(toLight, toLight);
        if (distSq > 1.0e-8) {
          float dist = sqrt(distSq);
          vec3 lArea = toLight / dist;
          float nDotLArea = max(dot(n, lArea), 0.0);
          float lightCos = max(dot(lightNormal, -lArea), 0.0);
          if (nDotLArea > 0.0 && lightCos > 0.0) {
            float maxShadowDistance = max(dist - minDistPTPhys() * 8.0, minDistPTPhys() * 8.0);
            float vis = traceVisibility(hitPos + n * minDistPTPhys() * 6.0, lArea, maxShadowDistance);
            if (vis > 0.0) {
              vec3 fArea;
              float pdfBsdfArea;
              evaluateBSDF(n, v, lArea, base, roughness, metallic, reflectivity, fArea, pdfBsdfArea);
              float pdfAreaToSolid = pdfArea * distSq / max(lightCos, 1.0e-6);
              if (pdfAreaToSolid > 0.0) {
                float w = powerHeuristic(pdfAreaToSolid, pdfBsdfArea);
                radiance += throughput * fArea * nDotLArea * lightRadiance * vis * (w / pdfAreaToSolid);
              }
            }
          }
        }
      }
    }

    float dielectricF0 = reflectivity * 0.08;
    vec3 f0 = mix(vec3(dielectricF0), base, metallic);
    float pSpec = specularLobeProbability(f0, roughness);

    vec3 wi;
    if (rand(rng) < pSpec) {
      vec3 h = sampleGGXHalfVector(n, roughness, rng);
      wi = reflect(-v, h);
      if (dot(n, wi) <= 0.0) {
        break;
      }
    } else {
      wi = sampleCosineHemisphere(n, rng);
    }

    vec3 f;
    float pdf;
    evaluateBSDF(n, v, wi, base, roughness, metallic, reflectivity, f, pdf);
    float nDotL = max(dot(n, wi), 0.0);
    if (nDotL <= 0.0 || pdf <= 1.0e-6) {
      break;
    }

    throughput *= (f * nDotL / pdf) * uIntegrator_albedo;
    origin = hitPos + n * (minDistPTPhys() * 6.0);
    direction = wi;

    if (bounce >= 2) {
      float survive = clamp(max(max(throughput.r, throughput.g), throughput.b), 0.05, 0.98);
      if (rand(rng) > survive) {
        break;
      }
      throughput /= survive;
    }
  }

  if (uIntegrator_sampleClamp > 0.0) {
    return min(radiance, vec3(uIntegrator_sampleClamp));
  }
  return radiance;
}
`;

export const INTEGRATORS: IntegratorDefinition[] = [
  {
    id: "fast-raymarch",
    name: "Fast Raymarch",
    description: "DE surface raymarcher tuned for high interactivity.",
    options: buildFastOptions({
      detailAOExp: -1.6,
      maxRaySteps: 128,
      maxDistance: 500,
      aoStrength: 0.2,
      aoSamples: 2,
      shadowStrength: 0.2,
      fog: 0.08,
      backgroundStrength: 0.2
    }),
    glsl: deFastRaymarchGlsl
  },
  {
    id: "de-raytracer",
    name: "DE Raytracer (Quality)",
    description: "Cook-Torrance GGX shading with metalness/roughness and optional orbit-trap hue blending.",
    options: deQualityOptionTemplate,
    glsl: deQualityRaytracerPbrGlsl
  },
  {
    id: "de-pathtracer-physical",
    name: "DE Path Tracer (Physical)",
    description: "Corrected path tracer with GGX+Lambert BSDF, MIS sun lighting, and improved energy handling.",
    options: [
      { key: "detailExp", label: "Detail", min: -7, max: 0, defaultValue: -2.7, step: 0.01 },
      { key: "maxRaySteps", label: "Max Steps", min: 16, max: 1536, defaultValue: 200, step: 1 },
      { key: "fudgeFactor", label: "Fudge Factor", min: 0.25, max: 2, defaultValue: 1, step: 0.01 },
      { key: "bounceCount", label: "Bounces", min: 1, max: 16, defaultValue: 6, step: 1 },
      { key: "albedo", label: "Albedo", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "roughness", label: "Roughness", min: 0.02, max: 1, defaultValue: 0.35, step: 0.01 },
      { key: "metallic", label: "Metallic", min: 0, max: 1, defaultValue: 0, step: 0.01 },
      { key: "reflectivity", label: "Reflectivity", min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
      { key: "useOrbitTrap", label: "Use Orbit Trap", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "orbitTrapFalloff", label: "Trap Falloff", min: 0.1, max: 24, defaultValue: 5.5, step: 0.01 },
      { key: "directLight", label: "Direct Light", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "sunStrength", label: "Sun Strength", min: 0, max: 20, defaultValue: 6, step: 0.01 },
      { key: "skyStrength", label: "Sky Strength", min: 0, max: 5, defaultValue: 1, step: 0.01 },
      {
        key: "sunAngularDiameterDeg",
        label: "Sun Diameter",
        min: 0.05,
        max: 5,
        defaultValue: 0.53,
        step: 0.01
      },
      { key: "areaLightEnabled", label: "Area Light", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "areaLightIntensity", label: "Area Intensity", min: 0, max: 100, defaultValue: 10, step: 0.01 },
      { key: "areaLightSize", label: "Area Half Size", min: 0.01, max: 10, defaultValue: 0.5, step: 0.01 },
      { key: "areaLightOffsetX", label: "Area Off X", min: -20, max: 20, defaultValue: 0, step: 0.01 },
      { key: "areaLightOffsetY", label: "Area Off Y", min: -20, max: 20, defaultValue: 0, step: 0.01 },
      { key: "areaLightOffsetZ", label: "Area Off Z", min: -20, max: 20, defaultValue: 0, step: 0.01 },
      { key: "areaLightColorR", label: "Area Color R", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "areaLightColorG", label: "Area Color G", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "areaLightColorB", label: "Area Color B", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "aperture", label: "Aperture", min: 0, max: 0.2, defaultValue: 0, step: 0.0001 },
      { key: "focalDistance", label: "Focal Dist", min: 0.05, max: 4000, defaultValue: 6, step: 0.01 },
      { key: "aaJitter", label: "AA Jitter", min: 0, max: 2, defaultValue: 1, step: 0.01 },
      { key: "maxDistance", label: "Max Distance", min: 50, max: 5000, defaultValue: 1500, step: 1 },
      { key: "sampleClamp", label: "Sample Clamp", min: 0, max: 64, defaultValue: 0, step: 0.1 }
    ],
    glsl: dePathTracerPhysicalGlsl
  }
];

export function getIntegratorById(id: string): IntegratorDefinition {
  const integrator = INTEGRATORS.find((entry) => entry.id === id);
  if (integrator === undefined) {
    throw new Error(`Unknown integrator: ${id}`);
  }
  return integrator;
}

export function getDefaultIntegratorOptions(id: string): IntegratorOptionValues {
  const integrator = getIntegratorById(id);
  return integrator.options.reduce<IntegratorOptionValues>((acc, option) => {
    acc[option.key] = option.defaultValue;
    return acc;
  }, {});
}
