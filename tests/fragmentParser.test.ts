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
});
