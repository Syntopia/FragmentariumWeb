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
uniform float uIntegrator_shadowSoftness;
uniform float uIntegrator_fog;
uniform float uIntegrator_backgroundStrength;
uniform float uIntegrator_sunAzimuth;
uniform float uIntegrator_sunElevation;

const int MAX_TRACE_STEPS = 1024;
const int MAX_AO_SAMPLES = 8;

vec3 computeSunDirection() {
  float az = radians(uIntegrator_sunAzimuth);
  float el = radians(uIntegrator_sunElevation);
  float cosEl = cos(el);
  return normalize(vec3(sin(az) * cosEl, sin(el), cos(az) * cosEl));
}

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
  float prevT = 0.0;

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= uIntegrator_maxRaySteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float eps = hitEpsilon(t);
    float d = fragmentariumWebDETrace(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      float lo = prevT;
      float hi = t;
      for (int b = 0; b < 4; b++) {
        float mid = 0.5 * (lo + hi);
        if (fragmentariumWebDESample(ro + rd * mid) * uIntegrator_fudgeFactor < hitEpsilon(mid)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      hitT = hi;
      return true;
    }

    prevT = t;
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
    visibility = min(visibility, uIntegrator_shadowSoftness * d / max(t, 1.0e-5));
    if (visibility < 0.01) {
      return 0.0;
    }
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
  vec3 sunDir = computeSunDirection();
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
  { key: "shadowSoftness", label: "Shadow Softness", min: 1, max: 100, defaultValue: 12, step: 0.1 },
  { key: "fog", label: "Fog", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
  { key: "backgroundStrength", label: "Background", min: 0, max: 1, defaultValue: 0.2, step: 0.01 },
  { key: "sunAzimuth", label: "Sun Azimuth", min: 0, max: 360, defaultValue: 20, step: 0.1 },
  { key: "sunElevation", label: "Sun Elevation", min: -10, max: 90, defaultValue: 45, step: 0.1 },
  { key: "aperture", label: "Aperture", min: 0, max: 0.2, defaultValue: 0, step: 0.0001 },
  { key: "focalDistance", label: "Focal Dist", min: 0.05, max: 4000, defaultValue: 6, step: 0.01 },
  { key: "aaJitter", label: "AA Jitter", min: 0, max: 2, defaultValue: 1, step: 0.01 },
  { key: "slicePlaneEnabled", label: "Slice Plane", min: 0, max: 1, defaultValue: 0, step: 1 },
  { key: "slicePlaneDistance", label: "Slice Dist", min: 0, max: 20, defaultValue: 2, step: 0.01 },
  { key: "slicePlaneLock", label: "Slice Lock", min: 0, max: 1, defaultValue: 0, step: 1 },
  { key: "slicePlaneKeepFarSide", label: "Slice Keep Far", min: 0, max: 1, defaultValue: 1, step: 1 }
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
uniform float uIntegrator_shadowSoftness;
uniform float uIntegrator_fog;
uniform float uIntegrator_backgroundStrength;
uniform float uIntegrator_sunAzimuth;
uniform float uIntegrator_sunElevation;

uniform float uIntegrator_diffuseColorR;
uniform float uIntegrator_diffuseColorG;
uniform float uIntegrator_diffuseColorB;
uniform int uIntegrator_useOrbitTrap;
uniform int uIntegrator_orbitTrapPaletteIndex;
uniform float uIntegrator_orbitTrapFalloff;
uniform float uIntegrator_orbitTrapHueOffset;
uniform float uIntegrator_orbitTrapHueScale;
uniform float uIntegrator_orbitTrapSaturation;
uniform float uIntegrator_orbitTrapValue;
uniform float uIntegrator_orbitTrapMix;
uniform float uIntegrator_metalness;
uniform float uIntegrator_roughness;
uniform float uIntegrator_sunStrength;
uniform float uIntegrator_ambientStrength;
uniform float uIntegrator_specularStrength;
uniform float uIntegrator_sssStrength;
uniform float uIntegrator_sssRadius;

const int MAX_TRACE_STEPS = 1024;
const int MAX_AO_SAMPLES = 8;
const float PI_SURFACE = 3.141592653589793;

vec3 computeSunDirection() {
  float az = radians(uIntegrator_sunAzimuth);
  float el = radians(uIntegrator_sunElevation);
  float cosEl = cos(el);
  return normalize(vec3(sin(az) * cosEl, sin(el), cos(az) * cosEl));
}

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
  float prevT = 0.0;

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= uIntegrator_maxRaySteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float eps = hitEpsilon(t);
    float d = fragmentariumWebDETrace(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      float lo = prevT;
      float hi = t;
      for (int b = 0; b < 4; b++) {
        float mid = 0.5 * (lo + hi);
        if (fragmentariumWebDESample(ro + rd * mid) * uIntegrator_fudgeFactor < hitEpsilon(mid)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      hitT = hi;
      return true;
    }

    prevT = t;
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
    visibility = min(visibility, uIntegrator_shadowSoftness * d / max(t, 1.0e-5));
    if (visibility < 0.01) {
      return 0.0;
    }
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

vec3 fragmentariumWebOrbitTrapIqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  const float TAU = 6.28318530718;
  return a + b * cos(TAU * (c * t + d));
}

vec3 fragmentariumWebOrbitTrapPaletteColor(float t, int paletteIndex) {
  if (paletteIndex == 1) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)
    );
  }
  if (paletteIndex == 2) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.10, 0.20)
    );
  }
  if (paletteIndex == 3) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.30, 0.20, 0.20)
    );
  }
  if (paletteIndex == 4) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.80, 0.90, 0.30)
    );
  }
  if (paletteIndex == 5) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.20)
    );
  }
  if (paletteIndex == 6) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.50, 0.20, 0.25)
    );
  }
  if (paletteIndex == 7) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.0, 0.25, 0.25)
    );
  }
  return vec3(1.0);
}

vec3 applyOrbitTrapHueBlend(vec3 baseColor) {
  if (uIntegrator_useOrbitTrap <= 0) {
    return baseColor;
  }
  float trapVal = fragmentariumWebOrbitTrapValue(uIntegrator_orbitTrapFalloff);
  float phase = uIntegrator_orbitTrapHueOffset + trapVal * uIntegrator_orbitTrapHueScale;
  float saturation = clamp(uIntegrator_orbitTrapSaturation, 0.0, 1.0);
  float value = max(uIntegrator_orbitTrapValue, 0.0);
  int paletteIndex = clamp(uIntegrator_orbitTrapPaletteIndex, 0, 7);
  vec3 trapHue;
  if (paletteIndex <= 0) {
    float hue = fract(phase);
    trapHue = hsv2rgb(vec3(hue, saturation, value));
  } else {
    trapHue = fragmentariumWebOrbitTrapPaletteColor(phase, paletteIndex);
    float luma = dot(trapHue, vec3(0.2126, 0.7152, 0.0722));
    trapHue = mix(vec3(luma), trapHue, saturation);
    trapHue *= (1.0 + value);
  }
  float mixAmount = clamp(trapVal * clamp(uIntegrator_orbitTrapMix, 0.0, 1.0), 0.0, 1.0);
  return mix(baseColor, trapHue, mixAmount);
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

vec3 materialBaseColor(vec3 p, vec3 n) {
  vec3 systemBase = clamp(fragmentariumResolveBaseColor(p, n), vec3(0.0), vec3(1.0));
  vec3 tint = clamp(
    vec3(uIntegrator_diffuseColorR, uIntegrator_diffuseColorG, uIntegrator_diffuseColorB),
    vec3(0.0),
    vec3(1.0)
  );
  return applyOrbitTrapHueBlend(clamp(systemBase * tint, vec3(0.0), vec3(1.0)));
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

  vec3 baseCol = materialBaseColor(p, n);
  float m = clamp(uIntegrator_metalness, 0.0, 1.0);
  float r = clamp(uIntegrator_roughness, 0.0, 1.0);
  float alphaR = max(1.0e-3, r * r);

  vec3 sunDir = computeSunDirection();
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

  if (uIntegrator_sssStrength > 0.0) {
    float thickness = clamp(fragmentariumWebDESample(p - n * uIntegrator_sssRadius), 0.0, 1.0);
    float sssAmount = (1.0 - thickness) * max(dot(sunDir, -n) * 0.5 + 0.5, 0.0);
    vec3 sssColor = baseCol * sunRadiance * sssAmount * uIntegrator_sssStrength;
    lit += sssColor * adjustedShadow;
  }

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
  { key: "shadowSoftness", label: "Shadow Softness", min: 1, max: 100, defaultValue: 12, step: 0.1 },
  { key: "fog", label: "Fog", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
  { key: "backgroundStrength", label: "Background", min: 0, max: 1, defaultValue: 0.2, step: 0.01 },
  { key: "sunAzimuth", label: "Sun Azimuth", min: 0, max: 360, defaultValue: 20, step: 0.1 },
  { key: "sunElevation", label: "Sun Elevation", min: -10, max: 90, defaultValue: 45, step: 0.1 },
  { key: "diffuseColorR", label: "Diffuse R", min: 0, max: 1, defaultValue: 0.9, step: 0.01 },
  { key: "diffuseColorG", label: "Diffuse G", min: 0, max: 1, defaultValue: 0.82, step: 0.01 },
  { key: "diffuseColorB", label: "Diffuse B", min: 0, max: 1, defaultValue: 0.72, step: 0.01 },
  { key: "useOrbitTrap", label: "Use Orbit Trap", min: 0, max: 1, defaultValue: 1, step: 1 },
  { key: "orbitTrapPaletteIndex", label: "Trap Palette", min: 0, max: 7, defaultValue: 0, step: 1 },
  { key: "orbitTrapFalloff", label: "Trap Falloff", min: 0.1, max: 24, defaultValue: 5.5, step: 0.01 },
  { key: "orbitTrapHueOffset", label: "Trap Hue Shift", min: -1, max: 1, defaultValue: 0, step: 0.01 },
  { key: "orbitTrapHueScale", label: "Trap Hue Scale", min: -8, max: 8, defaultValue: 1, step: 0.01 },
  { key: "orbitTrapSaturation", label: "Trap Saturation", min: 0, max: 1, defaultValue: 1, step: 0.01 },
  { key: "orbitTrapValue", label: "Trap Value", min: 0, max: 2, defaultValue: 0, step: 0.01 },
  { key: "orbitTrapMix", label: "Trap Mix", min: 0, max: 1, defaultValue: 1, step: 0.01 },
  { key: "metalness", label: "Metalness", min: 0, max: 1, defaultValue: 0.05, step: 0.01 },
  { key: "roughness", label: "Roughness", min: 0, max: 1, defaultValue: 0.35, step: 0.01 },
  { key: "aperture", label: "Aperture", min: 0, max: 0.2, defaultValue: 0, step: 0.0001 },
  { key: "focalDistance", label: "Focal Dist", min: 0.05, max: 4000, defaultValue: 6, step: 0.01 },
  { key: "aaJitter", label: "AA Jitter", min: 0, max: 2, defaultValue: 1, step: 0.01 },
  { key: "slicePlaneEnabled", label: "Slice Plane", min: 0, max: 1, defaultValue: 0, step: 1 },
  { key: "slicePlaneDistance", label: "Slice Dist", min: 0, max: 20, defaultValue: 2, step: 0.01 },
  { key: "slicePlaneLock", label: "Slice Lock", min: 0, max: 1, defaultValue: 0, step: 1 },
  { key: "slicePlaneKeepFarSide", label: "Slice Keep Far", min: 0, max: 1, defaultValue: 1, step: 1 },
  { key: "sunStrength", label: "Sun Strength", min: 0, max: 20, defaultValue: 4.5, step: 0.01 },
  { key: "ambientStrength", label: "Ambient", min: 0, max: 3, defaultValue: 0.8, step: 0.01 },
  { key: "specularStrength", label: "Specular", min: 0, max: 3, defaultValue: 1.0, step: 0.01 },
  { key: "sssStrength", label: "SSS Strength", min: 0, max: 2, defaultValue: 0, step: 0.01 },
  { key: "sssRadius", label: "SSS Radius", min: 0.001, max: 1, defaultValue: 0.1, step: 0.001 }
];

const dePathTracerPhysicalGlsl = `
#define FRAGMENTARIUM_WEB_HAS_PCG_RNG
uniform float uIntegrator_detailExp;
uniform int uIntegrator_maxRaySteps;
uniform float uIntegrator_fudgeFactor;
uniform int uIntegrator_bounceCount;
uniform float uIntegrator_albedo;
uniform float uIntegrator_roughness;
uniform float uIntegrator_metallic;
uniform float uIntegrator_reflectivity;
uniform float uIntegrator_diffuseColorR;
uniform float uIntegrator_diffuseColorG;
uniform float uIntegrator_diffuseColorB;
uniform int uIntegrator_useOrbitTrap;
uniform int uIntegrator_orbitTrapPaletteIndex;
uniform float uIntegrator_orbitTrapFalloff;
uniform float uIntegrator_orbitTrapHueOffset;
uniform float uIntegrator_orbitTrapHueScale;
uniform float uIntegrator_orbitTrapSaturation;
uniform float uIntegrator_orbitTrapValue;
uniform float uIntegrator_orbitTrapMix;
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
uniform float uIntegrator_sunAzimuth;
uniform float uIntegrator_sunElevation;
uniform int uIntegrator_iblEnabled;
uniform float uIntegrator_iblStrength;
uniform float uIntegrator_iblExposure;
uniform float uIntegrator_iblRotationDeg;
uniform float uIntegrator_iblHorizonGlow;
uniform float uIntegrator_iblHotspotStrength;
uniform float uIntegrator_iblHotspotSizeDeg;
uniform float uIntegrator_iblTopColorR;
uniform float uIntegrator_iblTopColorG;
uniform float uIntegrator_iblTopColorB;
uniform float uIntegrator_iblHorizonColorR;
uniform float uIntegrator_iblHorizonColorG;
uniform float uIntegrator_iblHorizonColorB;
uniform float uIntegrator_iblGroundColorR;
uniform float uIntegrator_iblGroundColorG;
uniform float uIntegrator_iblGroundColorB;

const int MAX_TRACE_STEPS = 1536;
const int MAX_BOUNCES = 16;
const float PI = 3.141592653589793;
const float INV_PI = 0.3183098861837907;

vec3 computeSunDirection() {
  float az = radians(uIntegrator_sunAzimuth);
  float el = radians(uIntegrator_sunElevation);
  float cosEl = cos(el);
  return normalize(vec3(sin(az) * cosEl, sin(el), cos(az) * cosEl));
}

vec3 rotateYDegrees(vec3 v, float deg) {
  float a = radians(deg);
  float c = cos(a);
  float s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

float minDistPTPhys() {
  return max(pow(10.0, uIntegrator_detailExp), 1.0e-6);
}

float hitEpsilonPT(float t) {
  float eps = minDistPTPhys();
  return max(eps, eps * 0.01 * t);
}

vec3 estimateNormalPTPhys(vec3 p, float t) {
  float e = max(hitEpsilonPT(t) * 0.5, 1.0e-6);
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

vec3 fragmentariumWebOrbitTrapIqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  const float TAU = 6.28318530718;
  return a + b * cos(TAU * (c * t + d));
}

vec3 fragmentariumWebOrbitTrapPaletteColor(float t, int paletteIndex) {
  if (paletteIndex == 1) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)
    );
  }
  if (paletteIndex == 2) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.10, 0.20)
    );
  }
  if (paletteIndex == 3) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.30, 0.20, 0.20)
    );
  }
  if (paletteIndex == 4) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.80, 0.90, 0.30)
    );
  }
  if (paletteIndex == 5) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.20)
    );
  }
  if (paletteIndex == 6) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.50, 0.20, 0.25)
    );
  }
  if (paletteIndex == 7) {
    return fragmentariumWebOrbitTrapIqPalette(
      t, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.0, 0.25, 0.25)
    );
  }
  return vec3(1.0);
}

vec3 applyOrbitTrapHueBlendPT(vec3 baseColor) {
  if (uIntegrator_useOrbitTrap <= 0) {
    return baseColor;
  }
  float trapVal = fragmentariumWebOrbitTrapValue(uIntegrator_orbitTrapFalloff);
  float phase = uIntegrator_orbitTrapHueOffset + trapVal * uIntegrator_orbitTrapHueScale;
  float saturation = clamp(uIntegrator_orbitTrapSaturation, 0.0, 1.0);
  float value = max(uIntegrator_orbitTrapValue, 0.0);
  int paletteIndex = clamp(uIntegrator_orbitTrapPaletteIndex, 0, 7);
  vec3 trapHue;
  if (paletteIndex <= 0) {
    float hue = fract(phase);
    trapHue = hsv2rgb(vec3(hue, saturation, value));
  } else {
    trapHue = fragmentariumWebOrbitTrapPaletteColor(phase, paletteIndex);
    float luma = dot(trapHue, vec3(0.2126, 0.7152, 0.0722));
    trapHue = mix(vec3(luma), trapHue, saturation);
    trapHue *= (1.0 + value);
  }
  float mixAmount = clamp(trapVal * clamp(uIntegrator_orbitTrapMix, 0.0, 1.0), 0.0, 1.0);
  return mix(baseColor, trapHue, mixAmount);
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
  float prevT = 0.0;
  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= uIntegrator_maxRaySteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float eps = hitEpsilonPT(t);
    float d = fragmentariumWebDETrace(p) * uIntegrator_fudgeFactor;
    if (d < eps) {
      float lo = prevT;
      float hi = t;
      for (int b = 0; b < 4; b++) {
        float mid = 0.5 * (lo + hi);
        if (fragmentariumWebDESample(ro + rd * mid) * uIntegrator_fudgeFactor < hitEpsilonPT(mid)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      t = hi;
      hitPos = ro + rd * t;
      hitNormal = estimateNormalPTPhys(hitPos, t);
      hitT = t;
      return true;
    }

    prevT = t;
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
  float baseEps = minDistPTPhys();
  float t = baseEps * 4.0;
  int shadowSteps = max(8, uIntegrator_maxRaySteps / 2);

  for (int i = 0; i < MAX_TRACE_STEPS; i++) {
    if (i >= shadowSteps) {
      break;
    }

    vec3 p = ro + rd * t;
    float eps = hitEpsilonPT(t);
    float d = fragmentariumWebDESample(p) * uIntegrator_fudgeFactor * 1.2;
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
  return computeSunDirection();
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

vec3 iblRadiancePT(vec3 rd) {
  if (uIntegrator_iblEnabled <= 0) {
    return vec3(0.0);
  }

  vec3 d = normalize(rotateYDegrees(rd, uIntegrator_iblRotationDeg));
  float skyT = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  float groundT = clamp((-d.y) * 0.5 + 0.5, 0.0, 1.0);

  vec3 top = clamp(vec3(uIntegrator_iblTopColorR, uIntegrator_iblTopColorG, uIntegrator_iblTopColorB), vec3(0.0), vec3(8.0));
  vec3 horizon = clamp(
    vec3(uIntegrator_iblHorizonColorR, uIntegrator_iblHorizonColorG, uIntegrator_iblHorizonColorB),
    vec3(0.0),
    vec3(8.0)
  );
  vec3 ground = clamp(
    vec3(uIntegrator_iblGroundColorR, uIntegrator_iblGroundColorG, uIntegrator_iblGroundColorB),
    vec3(0.0),
    vec3(8.0)
  );

  vec3 skyBand = mix(horizon, top, smoothstep(0.0, 1.0, skyT * skyT));
  vec3 groundBand = mix(horizon, ground, smoothstep(0.0, 1.0, groundT * groundT));
  vec3 env = d.y >= 0.0 ? skyBand : groundBand;

  float horizonGlow = exp(-abs(d.y) * 24.0) * max(uIntegrator_iblHorizonGlow, 0.0);
  env += horizon * horizonGlow;

  float hotspotCos = cos(0.5 * radians(clamp(uIntegrator_iblHotspotSizeDeg, 0.1, 180.0)));
  float hotspotAlign = dot(d, computeSunDirection());
  float hotspot = smoothstep(hotspotCos, 1.0, hotspotAlign);
  hotspot *= hotspot;
  env += vec3(1.0, 0.96, 0.9) * max(uIntegrator_iblHotspotStrength, 0.0) * hotspot;

  float gain = max(uIntegrator_iblStrength, 0.0) * exp2(uIntegrator_iblExposure);
  return env * gain;
}

vec3 environmentRadiancePT(vec3 rd) {
  if (uIntegrator_iblEnabled > 0) {
    return iblRadiancePT(rd);
  }
  return skyRadiance(rd);
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
  float lastPdf = 0.0;

  for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    if (bounce >= uIntegrator_bounceCount) {
      break;
    }

    vec3 hitPos;
    vec3 hitNormal;
    float hitT;
    bool hit = traceDE(origin, direction, hitPos, hitNormal, hitT);
    if (!hit) {
      vec3 env = environmentRadiancePT(direction);

      vec3 sunContrib = sunRadiance(direction);
      if (uIntegrator_directLight > 0 && bounce > 0 && lastPdf > 0.0) {
        float cosThetaMax = sunCosThetaMaxPT();
        float sunOmega = 2.0 * PI * (1.0 - cosThetaMax);
        float pdfLight = 1.0 / max(sunOmega, 1.0e-6);
        float w = powerHeuristic(lastPdf, pdfLight);
        env += sunContrib * w;
      } else {
        env += sunContrib;
      }

      if (uIntegrator_directLight > 0 && uIntegrator_areaLightEnabled > 0 && bounce > 0 && lastPdf > 0.0) {
        vec3 alDir, alRight, alUp;
        cameraBasisPT(alDir, alRight, alUp);
        vec3 alCenter = uEye + alRight * uIntegrator_areaLightOffsetX
                             + alUp * uIntegrator_areaLightOffsetY
                             + alDir * uIntegrator_areaLightOffsetZ;
        float denom = dot(alDir, direction);
        if (abs(denom) > 1.0e-6) {
          float tLight = dot(alCenter - origin, alDir) / denom;
          if (tLight > 0.0) {
            vec3 hitLight = origin + direction * tLight;
            vec3 alOffset = hitLight - alCenter;
            float halfSize = max(uIntegrator_areaLightSize, 1.0e-4);
            float u = dot(alOffset, alRight);
            float v = dot(alOffset, alUp);
            if (abs(u) <= halfSize && abs(v) <= halfSize) {
              float area = (2.0 * halfSize) * (2.0 * halfSize);
              float pdfArea = 1.0 / max(area, 1.0e-6);
              float distSq = tLight * tLight;
              float lightCos = abs(denom);
              float pdfAreaSolid = pdfArea * distSq / max(lightCos, 1.0e-6);
              float w = powerHeuristic(lastPdf, pdfAreaSolid);
              env += areaLightRadiancePT() * w;
            }
          }
        }
      }

      radiance += throughput * env;
      break;
    }

    float surfaceEps = hitEpsilonPT(hitT);
    vec3 n = hitNormal;
    vec3 v = normalize(-direction);
    vec3 base = clamp(fragmentariumResolveBaseColor(hitPos, n), vec3(0.0), vec3(1.0));
    vec3 tint = clamp(
      vec3(uIntegrator_diffuseColorR, uIntegrator_diffuseColorG, uIntegrator_diffuseColorB),
      vec3(0.0),
      vec3(1.0)
    );
    base = clamp(base * tint, vec3(0.0), vec3(1.0));
    base = applyOrbitTrapHueBlendPT(base);
    float roughness = clamp(uIntegrator_roughness, 0.02, 1.0);
    float metallic = clamp(uIntegrator_metallic, 0.0, 1.0);
    float reflectivity = clamp(uIntegrator_reflectivity, 0.0, 1.0);

    if (uIntegrator_directLight > 0) {
      float pdfLight = 0.0;
      vec3 lSun = sampleSunDirection(rng, pdfLight);
      float nDotLSun = max(dot(n, lSun), 0.0);
      if (nDotLSun > 0.0) {
        float vis = traceVisibility(hitPos + n * surfaceEps * 6.0, lSun, float(uIntegrator_maxDistance));
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
            float maxShadowDistance = max(dist - surfaceEps * 8.0, surfaceEps * 8.0);
            float vis = traceVisibility(hitPos + n * surfaceEps * 6.0, lArea, maxShadowDistance);
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
    lastPdf = pdf;
    origin = hitPos + n * (surfaceEps * 6.0);
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

function integratorOptionGroupForKey(key: string): string {
  if (key === "detailExp" || key === "detailAOExp" || key === "maxRaySteps" || key === "maxDistance" || key === "fudgeFactor") {
    return "Tracing";
  }
  if (key === "aoStrength" || key === "aoSamples" || key === "shadowStrength" || key === "shadowSoftness") {
    return "Shadows/AO";
  }
  if (key === "fog" || key === "backgroundStrength") {
    return "Environment";
  }
  if (
    key === "diffuseColorR" ||
    key === "diffuseColorG" ||
    key === "diffuseColorB" ||
    key === "metalness" ||
    key === "metallic" ||
    key === "roughness" ||
    key === "reflectivity" ||
    key === "specularStrength" ||
    key === "albedo" ||
    key === "sssStrength" ||
    key === "sssRadius"
  ) {
    return "Material";
  }
  if (key === "useOrbitTrap" || key.startsWith("orbitTrap")) {
    return "Orbit Trap";
  }
  if (key === "directLight" || key.startsWith("sun") || key === "ambientStrength" || key === "skyStrength") {
    return "Lighting";
  }
  if (key.startsWith("ibl")) {
    return "IBL";
  }
  if (key.startsWith("areaLight")) {
    return "Area Light";
  }
  if (
    key === "aperture" ||
    key === "focalDistance" ||
    key === "aaJitter" ||
    key === "slicePlaneEnabled" ||
    key === "slicePlaneDistance" ||
    key === "slicePlaneLock" ||
    key === "slicePlaneKeepFarSide"
  ) {
    return "Camera";
  }
  return "General";
}

function integratorSharedSemanticForKey(key: string): string | null {
  if (key === "metalness" || key === "metallic") {
    return "material.metalness";
  }
  if (key === "reflectivity") {
    return "material.reflectivity";
  }
  if (key === "roughness") {
    return "material.roughness";
  }
  if (key === "diffuseColorR") {
    return "material.tint.r";
  }
  if (key === "diffuseColorG") {
    return "material.tint.g";
  }
  if (key === "diffuseColorB") {
    return "material.tint.b";
  }
  if (key === "useOrbitTrap") {
    return "orbit.enable";
  }
  if (key.startsWith("orbitTrap")) {
    return `orbit.${key}`;
  }
  if (key === "sunAzimuth" || key === "sunElevation" || key === "sunStrength") {
    return `light.${key}`;
  }
  if (key === "slicePlaneEnabled") {
    return "camera.slicePlaneEnabled";
  }
  if (key === "slicePlaneDistance") {
    return "camera.slicePlaneDistance";
  }
  if (key === "slicePlaneLock") {
    return "camera.slicePlaneLock";
  }
  if (key === "slicePlaneKeepFarSide") {
    return "camera.slicePlaneKeepFarSide";
  }
  if (key === "aperture" || key === "focalDistance" || key === "aaJitter") {
    return `camera.${key}`;
  }
  if (key === "maxDistance" || key === "fudgeFactor" || key === "detailExp" || key === "maxRaySteps") {
    return `trace.${key}`;
  }
  return null;
}

function decorateIntegratorOptions(options: IntegratorOptionDefinition[]): IntegratorOptionDefinition[] {
  return options.map((option) => ({
    ...option,
    group: option.group ?? integratorOptionGroupForKey(option.key),
    sharedSemantic: option.sharedSemantic ?? (integratorSharedSemanticForKey(option.key) ?? undefined)
  }));
}

function clampOptionValue(option: IntegratorOptionDefinition, value: number): number {
  let next = Number.isFinite(value) ? value : option.defaultValue;
  next = Math.max(option.min, Math.min(option.max, next));
  const isInt = option.step === 1 && Number.isInteger(option.defaultValue);
  return isInt ? Math.round(next) : next;
}

export function transferSharedIntegratorOptions(
  fromIntegratorId: string,
  fromValues: IntegratorOptionValues,
  toIntegratorId: string,
  targetValues: IntegratorOptionValues
): IntegratorOptionValues {
  if (fromIntegratorId === toIntegratorId) {
    return { ...targetValues };
  }
  const from = getIntegratorById(fromIntegratorId);
  const to = getIntegratorById(toIntegratorId);

  const semanticValues = new Map<string, number>();
  for (const option of from.options) {
    if (option.sharedSemantic === undefined) {
      continue;
    }
    const value = fromValues[option.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    semanticValues.set(option.sharedSemantic, value);
  }

  const next: IntegratorOptionValues = { ...targetValues };
  for (const option of to.options) {
    if (option.sharedSemantic === undefined) {
      continue;
    }
    const value = semanticValues.get(option.sharedSemantic);
    if (value === undefined) {
      continue;
    }
    next[option.key] = clampOptionValue(option, value);
  }

  return next;
}

export const INTEGRATORS: IntegratorDefinition[] = [
  {
    id: "fast-raymarch",
    name: "Fast Raymarch",
    description: "DE surface raymarcher tuned for high interactivity.",
    options: decorateIntegratorOptions(buildFastOptions({
      detailAOExp: -1.6,
      maxRaySteps: 128,
      maxDistance: 500,
      aoStrength: 0.2,
      aoSamples: 2,
      shadowStrength: 0.2,
      fog: 0.08,
      backgroundStrength: 0.2
    })),
    glsl: deFastRaymarchGlsl
  },
  {
    id: "de-raytracer",
    name: "DE Raytracer (Quality)",
    description: "Cook-Torrance GGX shading with metalness/roughness and optional orbit-trap hue blending.",
    options: decorateIntegratorOptions(deQualityOptionTemplate),
    glsl: deQualityRaytracerPbrGlsl
  },
  {
    id: "de-pathtracer-physical",
    name: "DE Path Tracer (Physical)",
    description: "Corrected path tracer with GGX+Lambert BSDF, MIS sun lighting, and improved energy handling.",
    options: decorateIntegratorOptions([
      { key: "detailExp", label: "Detail", min: -7, max: 0, defaultValue: -2.7, step: 0.01 },
      { key: "maxRaySteps", label: "Max Steps", min: 16, max: 1536, defaultValue: 200, step: 1 },
      { key: "fudgeFactor", label: "Fudge Factor", min: 0.25, max: 2, defaultValue: 1, step: 0.01 },
      { key: "bounceCount", label: "Bounces", min: 1, max: 16, defaultValue: 3, step: 1 },
      { key: "albedo", label: "Albedo", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "roughness", label: "Roughness", min: 0.02, max: 1, defaultValue: 0.35, step: 0.01 },
      { key: "metallic", label: "Metallic", min: 0, max: 1, defaultValue: 0, step: 0.01 },
      { key: "reflectivity", label: "Reflectivity", min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
      { key: "diffuseColorR", label: "Diffuse R", min: 0, max: 1, defaultValue: 0.9, step: 0.01 },
      { key: "diffuseColorG", label: "Diffuse G", min: 0, max: 1, defaultValue: 0.82, step: 0.01 },
      { key: "diffuseColorB", label: "Diffuse B", min: 0, max: 1, defaultValue: 0.72, step: 0.01 },
      { key: "useOrbitTrap", label: "Use Orbit Trap", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "orbitTrapPaletteIndex", label: "Trap Palette", min: 0, max: 7, defaultValue: 0, step: 1 },
      { key: "orbitTrapFalloff", label: "Trap Falloff", min: 0.1, max: 24, defaultValue: 5.5, step: 0.01 },
      { key: "orbitTrapHueOffset", label: "Trap Hue Shift", min: -1, max: 1, defaultValue: 0, step: 0.01 },
      { key: "orbitTrapHueScale", label: "Trap Hue Scale", min: -8, max: 8, defaultValue: 1, step: 0.01 },
      { key: "orbitTrapSaturation", label: "Trap Saturation", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "orbitTrapValue", label: "Trap Value", min: 0, max: 2, defaultValue: 0, step: 0.01 },
      { key: "orbitTrapMix", label: "Trap Mix", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "directLight", label: "Direct Light", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "sunAzimuth", label: "Sun Azimuth", min: 0, max: 360, defaultValue: 20, step: 0.1 },
      { key: "sunElevation", label: "Sun Elevation", min: -10, max: 90, defaultValue: 45, step: 0.1 },
      { key: "sunStrength", label: "Sun Strength", min: 0, max: 20, defaultValue: 6, step: 0.01 },
      { key: "skyStrength", label: "Sky Strength", min: 0, max: 5, defaultValue: 1, step: 0.01 },
      { key: "iblEnabled", label: "IBL Enabled", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "iblStrength", label: "IBL Strength", min: 0, max: 20, defaultValue: 1, step: 0.01 },
      { key: "iblExposure", label: "IBL Exposure", min: -8, max: 8, defaultValue: 0, step: 0.01 },
      { key: "iblRotationDeg", label: "IBL Rotate", min: 0, max: 360, defaultValue: 0, step: 0.1 },
      { key: "iblHorizonGlow", label: "IBL Horizon Glow", min: 0, max: 4, defaultValue: 0.4, step: 0.01 },
      { key: "iblHotspotStrength", label: "IBL Hotspot", min: 0, max: 20, defaultValue: 0.8, step: 0.01 },
      { key: "iblHotspotSizeDeg", label: "IBL Hotspot Size", min: 0.1, max: 90, defaultValue: 12, step: 0.1 },
      { key: "iblTopColorR", label: "IBL Top R", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
      { key: "iblTopColorG", label: "IBL Top G", min: 0, max: 2, defaultValue: 0.35, step: 0.01 },
      { key: "iblTopColorB", label: "IBL Top B", min: 0, max: 2, defaultValue: 0.55, step: 0.01 },
      { key: "iblHorizonColorR", label: "IBL Horizon R", min: 0, max: 4, defaultValue: 0.9, step: 0.01 },
      { key: "iblHorizonColorG", label: "IBL Horizon G", min: 0, max: 4, defaultValue: 0.85, step: 0.01 },
      { key: "iblHorizonColorB", label: "IBL Horizon B", min: 0, max: 4, defaultValue: 0.75, step: 0.01 },
      { key: "iblGroundColorR", label: "IBL Ground R", min: 0, max: 2, defaultValue: 0.05, step: 0.01 },
      { key: "iblGroundColorG", label: "IBL Ground G", min: 0, max: 2, defaultValue: 0.06, step: 0.01 },
      { key: "iblGroundColorB", label: "IBL Ground B", min: 0, max: 2, defaultValue: 0.08, step: 0.01 },
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
      { key: "areaLightOffsetX", label: "Area Off X", min: -1, max: 1, defaultValue: 0, step: 0.01 },
      { key: "areaLightOffsetY", label: "Area Off Y", min: -1, max: 1, defaultValue: 0, step: 0.01 },
      { key: "areaLightOffsetZ", label: "Area Off Z", min: -1, max: 1, defaultValue: 0, step: 0.01 },
      { key: "areaLightColorR", label: "Area Color R", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "areaLightColorG", label: "Area Color G", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "areaLightColorB", label: "Area Color B", min: 0, max: 1, defaultValue: 1, step: 0.01 },
      { key: "aperture", label: "Aperture", min: 0, max: 0.2, defaultValue: 0, step: 0.0001 },
      { key: "focalDistance", label: "Focal Dist", min: 0.05, max: 4000, defaultValue: 6, step: 0.01 },
      { key: "aaJitter", label: "AA Jitter", min: 0, max: 2, defaultValue: 1, step: 0.01 },
      { key: "slicePlaneEnabled", label: "Slice Plane", min: 0, max: 1, defaultValue: 0, step: 1 },
      { key: "slicePlaneDistance", label: "Slice Dist", min: 0, max: 20, defaultValue: 2, step: 0.01 },
      { key: "slicePlaneLock", label: "Slice Lock", min: 0, max: 1, defaultValue: 0, step: 1 },
      { key: "slicePlaneKeepFarSide", label: "Slice Keep Far", min: 0, max: 1, defaultValue: 1, step: 1 },
      { key: "maxDistance", label: "Max Distance", min: 50, max: 5000, defaultValue: 1500, step: 1 },
      { key: "sampleClamp", label: "Sample Clamp", min: 0, max: 64, defaultValue: 3.0, step: 0.1 }
    ]),
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
