import { describe, expect, test } from "vitest";
import { parseFragmentSource } from "../src/core/parser/fragmentParser";

describe("parseFragmentSource", () => {
  test("parses include, uniforms, group, and presets", () => {
    const source = `
#camera 3D
#group Shape
uniform float Radius; slider[0.1,1.0,5.0]
uniform bool Toggle; checkbox[true]
#include "extra.frag"
#preset Default
Radius = 2.5
Toggle = false
#endpreset
`;

    const result = parseFragmentSource({
      source,
      sourceName: "main.frag",
      includeMap: {
        "extra.frag": "uniform vec3 Tint; color[0.1,0.2,0.3]"
      }
    });

    expect(result.cameraMode).toBe("3D");
    expect(result.uniforms.map((entry) => entry.name)).toEqual(["Radius", "Toggle", "Tint"]);

    const radius = result.uniforms.find((entry) => entry.name === "Radius");
    expect(radius?.group).toBe("Shape");
    expect(radius?.defaultValue).toBe(1.0);

    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe("Default");
    expect(result.presets[0].values.Radius).toBe(2.5);
    expect(result.presets[0].values.Toggle).toBe(false);

    expect(result.shaderSource).toContain("uniform float Radius;");
    expect(result.shaderSource).toContain("uniform vec3 Tint;");
  });

  test("throws for unresolved include", () => {
    expect(() =>
      parseFragmentSource({
        source: '#include "missing.frag"',
        sourceName: "main.frag",
        includeMap: {}
      })
    ).toThrow(/Include not found/);
  });

  test("supports legacy lock-token suffixes and skips non-numeric preset values", () => {
    const source = `
#group Camera
uniform vec3 Eye; //slider[(-50,-50,-50),(0,0,-10),(50,50,50)] NotLockable
uniform float Power; slider[0,8 NotLocked,16]
#preset Default
Power = 8 Locked
HDRTexture = Ditch-River_2k.hdr
#endpreset
float DE(vec3 p) { return length(p) - 1.0; }
`;

    const result = parseFragmentSource({
      source,
      sourceName: "legacy.frag",
      includeMap: {}
    });

    expect(result.uniforms.some((entry) => entry.name === "Power")).toBe(true);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].values.Power).toBe(8);
    expect(result.presets[0].values.HDRTexture).toBeUndefined();
  });

  test("preserves GLSL preprocessor directives while dropping Fragmentarium metadata directives", () => {
    const source = `
#info Example metadata
#define USE_COLOR 1
#if USE_COLOR
float marker = PI;
#else
float marker = 0.0;
#endif
#TexParameter palette.jpg GL_TEXTURE_2D GL_REPEAT
float DE(vec3 p) { return length(p) - 1.0; }
`;

    const result = parseFragmentSource({
      source,
      sourceName: "directives.frag",
      includeMap: {}
    });

    expect(result.shaderSource).toContain("#define USE_COLOR 1");
    expect(result.shaderSource).toContain("#if USE_COLOR");
    expect(result.shaderSource).toContain("#else");
    expect(result.shaderSource).toContain("#endif");
    expect(result.shaderSource).not.toContain("#info");
    expect(result.shaderSource).not.toContain("#TexParameter");
  });

  test("rewrites top-level uniform-dependent initializers to runtime assignments", () => {
    const source = `
uniform float Scale; slider[0,1,10]
float globalScale = Scale * 2.0;
float multiA = Scale, multiB = Scale + 1.0;

float DE(vec3 p) {
  float localValue = Scale;
  return length(p) - globalScale - localValue - multiA - multiB;
}
`;

    const result = parseFragmentSource({
      source,
      sourceName: "global-init.frag",
      includeMap: {}
    });

    expect(result.shaderSource).toContain("float globalScale;");
    expect(result.shaderSource).toContain("#define HAS_FRAGMENTARIUM_WEB_INIT_GLOBALS 1");
    expect(result.shaderSource).toContain("void fragmentariumWebInitGlobalsImpl() {");
    expect(result.shaderSource).toContain("globalScale = Scale * 2.0;");
    expect(result.shaderSource).toContain("float multiA, multiB;");
    expect(result.shaderSource).toContain("multiA = Scale;");
    expect(result.shaderSource).toContain("multiB = Scale + 1.0;");
    expect(result.shaderSource).not.toContain("float globalScale = Scale * 2.0;");
    expect(result.shaderSource).toContain("float localValue = Scale;");
  });

  test("strips unsupported trailing uniform annotations from raw GLSL output", () => {
    const source = `
uniform sampler2D tex; file[texture.jpg]
float DE(vec3 p) { return length(p) - 1.0; }
`;

    const result = parseFragmentSource({
      source,
      sourceName: "sampler.frag",
      includeMap: {}
    });

    expect(result.shaderSource).toContain("uniform sampler2D tex;");
    expect(result.shaderSource).not.toContain("file[texture.jpg]");
  });

  test("synthesizes orbit-trap coloring uniforms for legacy systems", () => {
    const source = `
vec4 orbitTrap = vec4(1.0e20);

float DE(vec3 p) {
  orbitTrap = min(orbitTrap, abs(vec4(p, dot(p, p))));
  return length(p) - 1.0;
}

#preset Default
BaseColor = 0.2,0.4,0.8
OrbitStrength = 0.7
CycleColors = true
Cycles = 3.5
#endpreset
`;

    const result = parseFragmentSource({
      source,
      sourceName: "orbittrap.frag",
      includeMap: {}
    });

    const uniformNames = result.uniforms.map((entry) => entry.name);
    expect(uniformNames).toEqual(
      expect.arrayContaining(["BaseColor", "OrbitStrength", "X", "Y", "Z", "R", "CycleColors", "Cycles"])
    );
    expect(result.groups).toContain("Coloring");
    expect(result.shaderSource).toContain("uniform vec3 BaseColor;");
    expect(result.shaderSource).toContain("uniform float OrbitStrength;");
    expect(result.shaderSource).toContain("uniform bool CycleColors;");
  });
});
