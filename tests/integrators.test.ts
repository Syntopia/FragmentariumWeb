import { describe, expect, test } from "vitest";
import {
  INTEGRATORS,
  getDefaultIntegratorOptions,
  getIntegratorById,
  transferSharedIntegratorOptions
} from "../src/core/integrators/definitions";

describe("integrators", () => {
  test("keeps fast and quality raster integrators distinct", () => {
    const fast = getIntegratorById("fast-raymarch");
    const quality = getIntegratorById("de-raytracer");

    expect(fast.glsl).not.toBe(quality.glsl);
    expect(fast.options.some((option) => option.key === "maxDistance")).toBe(true);
    expect(fast.options.some((option) => option.key === "aoSamples")).toBe(true);
    expect(fast.options.some((option) => option.key === "aperture")).toBe(true);
    expect(fast.options.some((option) => option.key === "focalDistance")).toBe(true);
    expect(fast.options.some((option) => option.key === "aaJitter")).toBe(true);
    expect(fast.options.some((option) => option.key === "slicePlaneEnabled")).toBe(true);
    expect(fast.options.some((option) => option.key === "slicePlaneDistance")).toBe(true);
    expect(fast.options.some((option) => option.key === "slicePlaneLock")).toBe(true);
    expect(fast.options.some((option) => option.key === "slicePlaneKeepFarSide")).toBe(true);
    expect(quality.options.some((option) => option.key === "maxDistance")).toBe(true);
    expect(quality.options.some((option) => option.key === "aoSamples")).toBe(true);
    expect(quality.options.some((option) => option.key === "metalness")).toBe(true);
    expect(quality.options.some((option) => option.key === "roughness")).toBe(true);
    expect(quality.options.some((option) => option.key === "useOrbitTrap")).toBe(true);
    expect(quality.options.some((option) => option.key === "orbitTrapPaletteIndex")).toBe(true);
    expect(quality.options.some((option) => option.key === "diffuseColorR")).toBe(true);
    expect(quality.options.some((option) => option.key === "slicePlaneEnabled")).toBe(true);
    expect(quality.options.some((option) => option.key === "slicePlaneDistance")).toBe(true);
    expect(quality.options.some((option) => option.key === "slicePlaneLock")).toBe(true);
    expect(quality.options.some((option) => option.key === "slicePlaneKeepFarSide")).toBe(true);

    const qualityDefaults = getDefaultIntegratorOptions("de-raytracer");
    expect(qualityDefaults.useOrbitTrap).toBe(1);
    expect(qualityDefaults.metalness).toBe(0.05);
    expect(qualityDefaults.roughness).toBe(0.35);
    expect(qualityDefaults.orbitTrapFalloff).toBe(5.5);
    expect(qualityDefaults.orbitTrapPaletteIndex).toBe(0);
    expect(qualityDefaults.orbitTrapHueOffset).toBe(0);
    expect(qualityDefaults.orbitTrapHueScale).toBe(1);
    expect(qualityDefaults.orbitTrapSaturation).toBe(1);
    expect(qualityDefaults.orbitTrapValue).toBe(0);
    expect(qualityDefaults.orbitTrapMix).toBe(1);
    expect(qualityDefaults.aperture).toBe(0);
    expect(qualityDefaults.focalDistance).toBe(6);
    expect(qualityDefaults.aaJitter).toBe(1);
    expect(qualityDefaults.slicePlaneEnabled).toBe(0);
    expect(qualityDefaults.slicePlaneDistance).toBe(2);
    expect(qualityDefaults.slicePlaneLock).toBe(0);
    expect(qualityDefaults.slicePlaneKeepFarSide).toBe(1);
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
    expect(integrator.options.some((option) => option.key === "diffuseColorR")).toBe(true);
    expect(integrator.options.some((option) => option.key === "useOrbitTrap")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapFalloff")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapPaletteIndex")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapHueOffset")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapHueScale")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapSaturation")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapValue")).toBe(true);
    expect(integrator.options.some((option) => option.key === "orbitTrapMix")).toBe(true);
    expect(integrator.options.some((option) => option.key === "sunAngularDiameterDeg")).toBe(true);
    expect(integrator.options.some((option) => option.key === "iblEnabled")).toBe(true);
    expect(integrator.options.some((option) => option.key === "iblStrength")).toBe(true);
    expect(integrator.options.some((option) => option.key === "iblZenithX")).toBe(true);
    expect(integrator.options.some((option) => option.key === "iblZenithY")).toBe(true);
    expect(integrator.options.some((option) => option.key === "iblZenithZ")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightEnabled")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightIntensity")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightSize")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightOffsetX")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightOffsetY")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightOffsetZ")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightColorR")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightColorG")).toBe(true);
    expect(integrator.options.some((option) => option.key === "areaLightColorB")).toBe(true);
    expect(integrator.options.some((option) => option.key === "aperture")).toBe(true);
    expect(integrator.options.some((option) => option.key === "focalDistance")).toBe(true);
    expect(integrator.options.some((option) => option.key === "aaJitter")).toBe(true);
    expect(integrator.options.some((option) => option.key === "slicePlaneEnabled")).toBe(true);
    expect(integrator.options.some((option) => option.key === "slicePlaneDistance")).toBe(true);
    expect(integrator.options.some((option) => option.key === "slicePlaneLock")).toBe(true);
    expect(integrator.options.some((option) => option.key === "slicePlaneKeepFarSide")).toBe(true);

    const defaults = getDefaultIntegratorOptions("de-pathtracer-physical");
    expect(defaults.bounceCount).toBe(3);
    expect(defaults.roughness).toBe(0.35);
    expect(defaults.sampleClamp).toBe(3);
    expect(defaults.useOrbitTrap).toBe(1);
    expect(defaults.orbitTrapFalloff).toBe(5.5);
    expect(defaults.orbitTrapPaletteIndex).toBe(0);
    expect(defaults.orbitTrapHueOffset).toBe(0);
    expect(defaults.orbitTrapHueScale).toBe(1);
    expect(defaults.orbitTrapSaturation).toBe(1);
    expect(defaults.orbitTrapValue).toBe(0);
    expect(defaults.orbitTrapMix).toBe(1);
    expect(defaults.diffuseColorR).toBe(0.9);
    expect(defaults.diffuseColorG).toBe(0.82);
    expect(defaults.diffuseColorB).toBe(0.72);
    expect(defaults.directLight).toBe(1);
    expect(defaults.sunDirectionX).toBe(0.2418);
    expect(defaults.sunDirectionY).toBe(0.7071);
    expect(defaults.sunDirectionZ).toBe(0.6645);
    expect(defaults.iblEnabled).toBe(1);
    expect(defaults.iblStrength).toBe(1);
    expect(defaults.iblExposure).toBe(0);
    expect(defaults.iblZenithX).toBe(0);
    expect(defaults.iblZenithY).toBe(1);
    expect(defaults.iblZenithZ).toBe(0);
    expect(defaults.detailExp).toBe(-2.7);
    expect(defaults.maxRaySteps).toBe(200);
    expect(defaults.areaLightEnabled).toBe(1);
    expect(defaults.areaLightIntensity).toBe(10);
    expect(defaults.areaLightSize).toBe(0.5);
    expect(defaults.areaLightOffsetX).toBe(0);
    expect(defaults.areaLightOffsetY).toBe(0);
    expect(defaults.areaLightOffsetZ).toBe(0);
    expect(defaults.areaLightColorR).toBe(1);
    expect(defaults.areaLightColorG).toBe(1);
    expect(defaults.areaLightColorB).toBe(1);
    expect(defaults.aperture).toBe(0);
    expect(defaults.focalDistance).toBe(6);
    expect(defaults.aaJitter).toBe(1);
    expect(defaults.slicePlaneEnabled).toBe(0);
    expect(defaults.slicePlaneDistance).toBe(2);
    expect(defaults.slicePlaneLock).toBe(0);
    expect(defaults.slicePlaneKeepFarSide).toBe(1);
  });

  test("throws for unknown integrator id", () => {
    expect(() => getIntegratorById("missing-integrator")).toThrow(/Unknown integrator/);
  });

  test("transfers shared material and orbit-trap settings across integrators", () => {
    const qualityDefaults = getDefaultIntegratorOptions("de-raytracer");
    const pathDefaults = getDefaultIntegratorOptions("de-pathtracer-physical");

    const transferred = transferSharedIntegratorOptions(
      "de-raytracer",
      {
        ...qualityDefaults,
        roughness: 0.62,
        metalness: 0.35,
        diffuseColorR: 0.1,
        diffuseColorG: 0.2,
        diffuseColorB: 0.3,
        orbitTrapFalloff: 9.5,
        orbitTrapPaletteIndex: 6,
        orbitTrapHueScale: 2.75,
        useOrbitTrap: 0,
        focalDistance: 12,
        slicePlaneEnabled: 1,
        slicePlaneDistance: 4.25,
        slicePlaneLock: 1,
        slicePlaneKeepFarSide: 0
      },
      "de-pathtracer-physical",
      pathDefaults
    );

    expect(transferred.roughness).toBe(0.62);
    expect(transferred.metallic).toBe(0.35);
    expect(transferred.diffuseColorR).toBe(0.1);
    expect(transferred.diffuseColorG).toBe(0.2);
    expect(transferred.diffuseColorB).toBe(0.3);
    expect(transferred.orbitTrapFalloff).toBe(9.5);
    expect(transferred.orbitTrapPaletteIndex).toBe(6);
    expect(transferred.orbitTrapHueScale).toBe(2.75);
    expect(transferred.useOrbitTrap).toBe(0);
    expect(transferred.focalDistance).toBe(12);
    expect(transferred.slicePlaneEnabled).toBe(1);
    expect(transferred.slicePlaneDistance).toBe(4.25);
    expect(transferred.slicePlaneLock).toBe(1);
    expect(transferred.slicePlaneKeepFarSide).toBe(0);
  });
});
