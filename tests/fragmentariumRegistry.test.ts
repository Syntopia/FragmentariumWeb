import { describe, expect, test } from "vitest";
import { FRACTAL_SYSTEMS, SYSTEM_INCLUDE_MAP, getSystemById } from "../src/systems/registry";

describe("fragmentarium registry", () => {
  test("loads migrated Fragmentarium 3D systems from manifest", () => {
    const exists = FRACTAL_SYSTEMS.some((entry) => entry.id === "fragmentarium/historical-3d-fractals/mandelbulb");
    expect(exists).toBe(true);

    const mandelbulb = getSystemById("fragmentarium/historical-3d-fractals/mandelbulb");
    expect(mandelbulb.treePath).toBe("Fragmentarium/Historical 3D Fractals/Mandelbulb");
    expect(mandelbulb.sourcePath).toBe("fragmentarium/examples/Historical 3D Fractals/Mandelbulb.frag");
    expect(mandelbulb.source).toContain("float DE(vec3 pos)");
    expect(mandelbulb.source).toContain('#include "common-camera-3d.frag"');
    expect(mandelbulb.source).not.toContain('#include "DE-Raytracer.frag"');
  });

  test("merges Fragmentarium include files into include map", () => {
    expect(SYSTEM_INCLUDE_MAP["MathUtils.frag"]).toBeTypeOf("string");
    expect(SYSTEM_INCLUDE_MAP["MathUtils.frag"].length).toBeGreaterThan(100);
    expect(SYSTEM_INCLUDE_MAP["common-camera-3d.frag"]).toContain("uniform vec3 Eye");
  });

  test("filters legacy full-pipeline Fragmentarium shaders from the selectable registry", () => {
    expect(FRACTAL_SYSTEMS.some((entry) => entry.id === "fragmentarium/kali-s-creations/treebroccoli")).toBe(false);
    expect(FRACTAL_SYSTEMS.some((entry) => entry.id === "fragmentarium/kali-s-creations/xray-skifs")).toBe(false);
    expect(FRACTAL_SYSTEMS.some((entry) => entry.id === "fragmentarium/knighty-collection/doyle-spirals")).toBe(false);
  });
});
