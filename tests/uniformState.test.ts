import { describe, expect, test } from "vitest";
import { resolvePresetUniformValues } from "../src/core/parser/uniformState";
import type { ParsedPreset, UniformDefinition } from "../src/core/parser/types";

const TEST_UNIFORMS: UniformDefinition[] = [
  {
    name: "Eye",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-20, -20, -20],
    max: [20, 20, 20],
    defaultValue: [0, 0, -6],
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Target",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-20, -20, -20],
    max: [20, 20, 20],
    defaultValue: [0, 0, 0],
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Power",
    type: "float",
    control: "slider",
    group: "Fractal",
    min: [1],
    max: [20],
    defaultValue: 8,
    lockType: "notlockable",
    tooltip: ""
  }
];

const TEST_PRESETS: ParsedPreset[] = [
  {
    name: "Start",
    raw: "",
    values: {
      Eye: [1, 2, 3],
      Target: [0.5, 0.25, 0.0],
      Power: 9
    }
  },
  {
    name: "OnlyPowerChanges",
    raw: "",
    values: {
      Power: 11
    }
  }
];

describe("uniformState.resolvePresetUniformValues", () => {
  test("resolves presets cumulatively in file order", () => {
    const values = resolvePresetUniformValues(TEST_UNIFORMS, TEST_PRESETS, "OnlyPowerChanges");

    expect(values.Eye).toEqual([1, 2, 3]);
    expect(values.Target).toEqual([0.5, 0.25, 0]);
    expect(values.Power).toBe(11);
  });

  test("returns defaults when preset name is missing", () => {
    const values = resolvePresetUniformValues(TEST_UNIFORMS, TEST_PRESETS, "Missing");
    expect(values.Eye).toEqual([0, 0, -6]);
    expect(values.Target).toEqual([0, 0, 0]);
    expect(values.Power).toBe(8);
  });
});
