import { describe, expect, test } from "vitest";
import { parseFragmentSource } from "../src/core/parser/fragmentParser";
import { getIntegratorById } from "../src/core/integrators/definitions";
import { buildSceneShaderSources } from "../src/core/render/shaderComposer";
import { FRACTAL_SYSTEMS, SYSTEM_INCLUDE_MAP } from "../src/systems/registry";

function splitTopLevelComma(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter((entry) => entry.length > 0);
}

describe("port compatibility", () => {
  test("all migrated Fragmentarium systems parse successfully", () => {
    const fragmentarium = FRACTAL_SYSTEMS.filter((s) => s.id.startsWith("fragmentarium/"));
    const failures: Array<{ id: string; message: string }> = [];

    for (const system of fragmentarium) {
      try {
        parseFragmentSource({
          source: system.source,
          sourceName: `${system.id}.frag`,
          includeMap: SYSTEM_INCLUDE_MAP
        });
      } catch (error) {
        failures.push({ id: system.id, message: error instanceof Error ? error.message : String(error) });
      }
    }

    expect(fragmentarium.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  test("parsed Fragmentarium shaders avoid top-level uniform-dependent initializers", () => {
    const fragmentarium = FRACTAL_SYSTEMS.filter((s) => s.id.startsWith("fragmentarium/"));
    const failures: Array<{ id: string; line: string }> = [];

    for (const system of fragmentarium) {
      const parsed = parseFragmentSource({
        source: system.source,
        sourceName: `${system.id}.frag`,
        includeMap: SYSTEM_INCLUDE_MAP
      });

      const uniformNames = new Set<string>();
      for (const line of parsed.shaderSource.split(/\r\n|\r|\n/)) {
        const match = line.match(/^\s*uniform\s+[A-Za-z_][A-Za-z0-9_]*\s+([^;]+)\s*;/);
        if (match === null) {
          continue;
        }
        for (const declarator of splitTopLevelComma(match[1])) {
          const nameMatch = declarator.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
          if (nameMatch !== null) {
            uniformNames.add(nameMatch[1]);
          }
        }
      }

      let depth = 0;
      for (const line of parsed.shaderSource.split(/\r\n|\r|\n/)) {
        const trimmed = line.trim();
        if (depth === 0) {
          const topDecl = line.match(
            /^\s*(?:(?:highp|mediump|lowp)\s+)?(?:float|int|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|uvec2|uvec3|uvec4|bvec2|bvec3|bvec4|mat2|mat3|mat4|mat2x2|mat2x3|mat2x4|mat3x2|mat3x3|mat3x4|mat4x2|mat4x3|mat4x4|uint)\s+(.+);\s*$/
          );
          if (topDecl !== null) {
            const declarators = splitTopLevelComma(topDecl[1]);
            for (const declarator of declarators) {
              const initMatch = declarator.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
              if (initMatch === null) {
                continue;
              }
              const expr = initMatch[1];
              const usesUniform = [...uniformNames].some((name) => new RegExp(`\\b${name}\\b`).test(expr));
              if (usesUniform) {
                failures.push({ id: system.id, line: trimmed });
              }
            }
          }
        }

        depth += (line.match(/\{/g) ?? []).length;
        depth -= (line.match(/\}/g) ?? []).length;
      }
    }

    expect(failures).toEqual([]);
  });

  test("KIFS Icosahedron keeps legacy init() call in composed shader", () => {
    const system = FRACTAL_SYSTEMS.find((s) => s.id === "fragmentarium/kaleidoscopic-ifs/icosahedron");
    expect(system).toBeDefined();
    if (system === undefined) {
      return;
    }

    const parsed = parseFragmentSource({
      source: system.source,
      sourceName: `${system.id}.frag`,
      includeMap: SYSTEM_INCLUDE_MAP
    });

    const composed = buildSceneShaderSources({
      geometrySource: parsed.shaderSource,
      integrator: getIntegratorById("de-pathtracer-physical")
    });

    expect(parsed.shaderSource).toContain("void init()");
    expect(composed.fragmentSource).toContain("init();");
  });

  test("orbit-trap Mandelbulb uses the bridge trap capture without synthetic palette uniforms", () => {
    const system = FRACTAL_SYSTEMS.find((s) => s.id === "fragmentarium/historical-3d-fractals/mandelbulb");
    expect(system).toBeDefined();
    if (system === undefined) {
      return;
    }

    const parsed = parseFragmentSource({
      source: system.source,
      sourceName: `${system.id}.frag`,
      includeMap: SYSTEM_INCLUDE_MAP
    });

    expect(parsed.uniforms.map((entry) => entry.name)).not.toContain("BaseColor");
    expect(parsed.uniforms.map((entry) => entry.name)).not.toContain("OrbitStrength");
    expect(parsed.shaderSource).not.toContain("uniform vec3 BaseColor;");
    expect(parsed.shaderSource).not.toContain("uniform float OrbitStrength;");

    const composed = buildSceneShaderSources({
      geometrySource: parsed.shaderSource,
      integrator: getIntegratorById("de-pathtracer-physical")
    });

    expect(composed.fragmentSource).toContain("float fragmentariumWebOrbitTrapValue(float falloff)");
    expect(composed.fragmentSource).toContain("fragmentariumResolveBaseColor");
    expect(composed.fragmentSource).not.toContain("vec3 fragmentariumWebOrbitTrapBaseColor()");
  });
});
