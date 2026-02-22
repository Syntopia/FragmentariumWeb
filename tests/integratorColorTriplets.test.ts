import { describe, expect, test } from "vitest";
import type { IntegratorOptionDefinition, IntegratorOptionValues } from "../src/core/integrators/types";
import {
  buildIntegratorOptionRenderItems,
  colorTripletPatchFromHex,
  colorTripletPatchFromIntensity,
  getColorTripletDisplayColorHex,
  getColorTripletIntensity,
  supportsHdrColorTripletIntensity
} from "../src/app/integratorColorTriplets";

const OPTIONS: IntegratorOptionDefinition[] = [
  { key: "roughness", label: "Roughness", min: 0, max: 1, defaultValue: 0.3 },
  { key: "iblTopColorR", label: "IBL Top R", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
  { key: "iblTopColorG", label: "IBL Top G", min: 0, max: 2, defaultValue: 0.35, step: 0.01 },
  { key: "iblTopColorB", label: "IBL Top B", min: 0, max: 2, defaultValue: 0.55, step: 0.01 },
  { key: "maxSteps", label: "Max Steps", min: 1, max: 512, defaultValue: 128 }
];

describe("integratorColorTriplets", () => {
  test("groups contiguous RGB scalar options into one color item", () => {
    const items = buildIntegratorOptionRenderItems(OPTIONS);
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("single");
    expect(items[1].kind).toBe("colorTriplet");
    expect(items[2].kind).toBe("single");
    if (items[1].kind === "colorTriplet") {
      expect(items[1].label).toBe("IBL Top");
      expect(supportsHdrColorTripletIntensity(items[1])).toBe(true);
    }
  });

  test("computes display color and patches values from hex and intensity", () => {
    const tripletItem = buildIntegratorOptionRenderItems(OPTIONS)[1];
    expect(tripletItem.kind).toBe("colorTriplet");
    if (tripletItem.kind !== "colorTriplet") {
      return;
    }
    const values: IntegratorOptionValues = {
      iblTopColorR: 0.4,
      iblTopColorG: 0.8,
      iblTopColorB: 1.2
    };

    expect(getColorTripletIntensity(tripletItem, values)).toBeCloseTo(1.2, 6);
    expect(getColorTripletDisplayColorHex(tripletItem, values)).toBe("#55aaff");

    const fromHex = colorTripletPatchFromHex(tripletItem, values, "#ff0000");
    expect(fromHex.iblTopColorR).toBeCloseTo(1.2, 6);
    expect(fromHex.iblTopColorG).toBeCloseTo(0, 6);
    expect(fromHex.iblTopColorB).toBeCloseTo(0, 6);

    const fromIntensity = colorTripletPatchFromIntensity(tripletItem, values, 2.0);
    expect(fromIntensity.iblTopColorB).toBeLessThanOrEqual(2);
    expect(fromIntensity.iblTopColorR).toBeCloseTo((0.4 / 1.2) * 2, 5);
  });
});

