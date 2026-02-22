import { describe, expect, test } from "vitest";
import { getIntegratorById } from "../src/core/integrators/definitions";
import { buildFocusProbeShaderSources, buildSceneShaderSources } from "../src/core/render/shaderComposer";

describe("buildSceneShaderSources", () => {
  test("injects guarded PI constants for legacy Fragmentarium systems", () => {
    const integrator = getIntegratorById("de-pathtracer-physical");
    const geometrySource = `
float DE(vec3 p) {
  return length(p) - (PI * 0.1);
}
`;

    const sources = buildSceneShaderSources({
      geometrySource,
      integrator
    });

    expect(sources.fragmentSource).toContain("#ifndef PI");
    expect(sources.fragmentSource).toContain("#define PI 3.14159265358979323846264");
    expect(sources.fragmentSource).toContain("#undef PI");
    expect(sources.fragmentSource).toContain("float DE(vec3 p);");
    expect(sources.fragmentSource).toContain("vec3 baseColor(vec3 p, vec3 n);");
    expect(sources.fragmentSource).toContain("return length(p) - (PI * 0.1);");
    expect(sources.fragmentSource).toContain("void fragmentariumWebInitGlobalsImpl() {}");
    expect(sources.fragmentSource).toContain("fragmentariumWebInitGlobalsImpl();");
    expect(sources.fragmentSource).not.toContain("  init();");
  });

  test("calls legacy init() when geometry defines it", () => {
    const integrator = getIntegratorById("de-pathtracer-physical");
    const geometrySource = `
#define providesInit
mat3 gRot;
void init() {
  gRot = mat3(1.0);
}
float DE(vec3 p) {
  return length(gRot * p) - 1.0;
}
`;

    const sources = buildSceneShaderSources({
      geometrySource,
      integrator
    });

    expect(sources.fragmentSource).toContain("void init() {");
    expect(sources.fragmentSource).toContain("Legacy Fragmentarium systems often require init()");
    expect(sources.fragmentSource).toContain("  init();");
  });

  test("adds orbit-trap bridge without legacy palette uniforms", () => {
    const integrator = getIntegratorById("de-raytracer");
    const geometrySource = `
vec4 orbitTrap = vec4(1.0e20);

float DE(vec3 p) {
  orbitTrap = min(orbitTrap, abs(vec4(p, dot(p, p))));
  return length(p) - 1.0;
}
`;

    const sources = buildSceneShaderSources({
      geometrySource,
      integrator
    });

    expect(sources.fragmentSource).toContain("float fragmentariumWebDETrace(vec3 p)");
    expect(sources.fragmentSource).toContain("float fragmentariumWebDESample(vec3 p)");
    expect(sources.fragmentSource).toContain("vec3 fragmentariumResolveBaseColor(vec3 p, vec3 n)");
    expect(sources.fragmentSource).toContain("return baseColor(p, n);");
    expect(sources.fragmentSource).not.toContain("vec3 fragmentariumWebOrbitTrapBaseColor()");
    expect(sources.fragmentSource).not.toContain("uniform vec3 BaseColor;");
    expect(sources.fragmentSource).not.toContain("uniform float OrbitStrength;");
    expect(sources.fragmentSource).not.toContain("uniform bool CycleColors;");
  });

  test("restores captured orbit trap before calling custom baseColor", () => {
    const integrator = getIntegratorById("de-pathtracer-physical");
    const geometrySource = `
vec4 orbitTrap = vec4(1.0e20);

vec3 baseColor(vec3 p, vec3 n) {
  return vec3(orbitTrap.x + orbitTrap.y + orbitTrap.z) * 0.1;
}

float DE(vec3 p) {
  orbitTrap = min(orbitTrap, abs(vec4(p, dot(p, p))));
  return length(p) - 1.0;
}
`;

    const sources = buildSceneShaderSources({
      geometrySource,
      integrator
    });

    expect(sources.fragmentSource).toContain("fragmentariumWebRestoreCapturedOrbitTrap();");
    expect(sources.fragmentSource).toContain("return baseColor(p, n);");
    expect(sources.fragmentSource).not.toContain("vec3 fragmentariumWebOrbitTrapBaseColor()");
  });

  test("injects thin-lens and AA uniforms for scene rendering", () => {
    const integrator = getIntegratorById("de-raytracer");
    const geometrySource = `
uniform float Aperture;
uniform float FocalPlane;
float DE(vec3 p) {
  return length(p) - 1.0;
}
`;

    const sources = buildSceneShaderSources({
      geometrySource,
      integrator
    });

    expect(sources.fragmentSource).toContain("uniform float uLensAperture;");
    expect(sources.fragmentSource).toContain("uniform float uLensFocalDistance;");
    expect(sources.fragmentSource).toContain("uniform float uAAStrength;");
    expect(sources.fragmentSource).toContain("uniform int uFrameIndex;");
    expect(sources.fragmentSource).toContain("float fragmentariumWebCameraAperture()");
    expect(sources.fragmentSource).toContain("return max(Aperture, 0.0);");
    expect(sources.fragmentSource).toContain("float fragmentariumWebCameraFocalDistance()");
    expect(sources.fragmentSource).toContain("return max(FocalPlane, 1.0e-4);");
    expect(sources.fragmentSource).toContain("cameraRay(gl_FragCoord.xy, rayOrigin, rayDir);");
    expect(sources.fragmentSource).toContain("renderColor(rayOrigin, rayDir)");
  });

  test("exposes fragment line map for geometry source diagnostics", () => {
    const integrator = getIntegratorById("de-raytracer");
    const geometrySource = `
float helper() { return 1.0; }
float DE(vec3 p) {
  return length(p) - helper();
}
`;
    const geometryLineMap = [
      { path: "main.frag", line: 1 },
      { path: "main.frag", line: 2 },
      { path: "main.frag", line: 3 },
      { path: "main.frag", line: 4 },
      { path: "main.frag", line: 5 }
    ];
    const sources = buildSceneShaderSources({
      geometrySource,
      geometryLineMap,
      integrator
    });
    expect(sources.fragmentLineMap).toBeDefined();
    const fragmentLines = sources.fragmentSource.split(/\r\n|\r|\n/);
    const deLineIndex = fragmentLines.findIndex((line) => line.includes("return length(p) - helper();"));
    expect(deLineIndex).toBeGreaterThanOrEqual(0);
    expect(sources.fragmentLineMap?.[deLineIndex]).toEqual({ path: "main.frag", line: 4 });
  });
});

describe("buildFocusProbeShaderSources", () => {
  test("builds a cursor-ray focus distance probe shader", () => {
    const geometrySource = `
float DE(vec3 p) {
  return length(p) - 1.0;
}
`;

    const sources = buildFocusProbeShaderSources({ geometrySource });
    expect(sources.fragmentSource).toContain("float fragmentariumWebTraceFocusDistance");
    expect(sources.fragmentSource).toContain("uniform vec2 uFocusUv;");
    expect(sources.fragmentSource).toContain("uniform vec2 uViewportSize;");
    expect(sources.fragmentSource).toContain("uniform vec3 uUp;");
    expect(sources.fragmentSource).toContain("uniform float uFov;");
    expect(sources.fragmentSource).toContain("uniform float uDetailExp;");
    expect(sources.fragmentSource).toContain("uniform int uMaxRaySteps;");
    expect(sources.fragmentSource).toContain("vec2 uv = focusUv * 2.0 - 1.0;");
    expect(sources.fragmentSource).toContain("vec2 cameraCoord = uv * uFov;");
    expect(sources.fragmentSource).toContain("fragColor = vec4(hitDistance, 0.0, 0.0, 1.0);");
  });
});
