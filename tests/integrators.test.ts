import { describe, expect, test } from "vitest";
import { INTEGRATORS, getDefaultIntegratorOptions, getIntegratorById } from "../src/core/integrators/definitions";

describe("integrators", () => {
  test("uses a shared DE surface core for fast and quality raster modes", () => {
    const fast = getIntegratorById("fast-raymarch");
    const quality = getIntegratorById("de-raytracer");

    expect(fast.glsl).toBe(quality.glsl);
    expect(fast.options.some((option) => option.key === "maxDistance")).toBe(true);
    expect(fast.options.some((option) => option.key === "aoSamples")).toBe(true);
    expect(quality.options.some((option) => option.key === "maxDistance")).toBe(true);
    expect(quality.options.some((option) => option.key === "aoSamples")).toBe(true);
  });

  test("does not register the legacy non-physical DE path tracer", () => {
    expect(INTEGRATORS.some((entry) => entry.id === "de-pathtracer")).toBe(false);
    expect(() => getIntegratorById("de-pathtracer")).toThrow(/Unknown integrator/);
  });

  test("registers the corrected physical DE path tracer", () => {
    const integrator = getIntegratorById("de-pathtracer-physical");
    expect(INTEGRATORS.some((entry) => entry.id === "de-pathtracer-physical")).toBe(true);
    expect(integrator.options.some((option) => option.key === "roughness")).toBe(true);
    expect(integrator.options.some((option) => option.key === "metallic")).toBe(true);
    expect(integrator.options.some((option) => option.key === "sunAngularDiameterDeg")).toBe(true);

    const defaults = getDefaultIntegratorOptions("de-pathtracer-physical");
    expect(defaults.bounceCount).toBe(6);
    expect(defaults.roughness).toBe(0.35);
    expect(defaults.sampleClamp).toBe(0);
    expect(defaults.directLight).toBe(1);
    expect(defaults.detailExp).toBe(-2.7);
    expect(defaults.maxRaySteps).toBe(200);
  });

  test("throws for unknown integrator id", () => {
    expect(() => getIntegratorById("missing-integrator")).toThrow(/Unknown integrator/);
  });
});
