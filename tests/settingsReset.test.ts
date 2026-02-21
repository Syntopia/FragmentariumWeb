import { describe, expect, test } from "vitest";
import type { ParsedPreset, UniformDefinition } from "../src/core/parser/types";
import { DEFAULT_RENDER_SETTINGS } from "../src/core/render/renderer";
import {
  buildDefaultUniformValuesForPreset,
  resetPostSettingsGroup,
  resetRenderSettingsGroup,
  resetUniformGroupValues
} from "../src/app/settingsReset";

const TEST_UNIFORMS: UniformDefinition[] = [
  {
    name: "FOV",
    type: "float",
    control: "slider",
    group: "Camera",
    min: [0.1],
    max: [1.5],
    defaultValue: 0.62,
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Eye",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-20, -20, -20],
    max: [20, 20, 20],
    defaultValue: [1.0, -1.0, 0.5],
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
    name: "Default",
    raw: "",
    values: {
      FOV: 0.75,
      Power: 9.5
    }
  }
];

describe("settingsReset", () => {
  test("resets render-group settings without changing post settings", () => {
    const current = {
      ...DEFAULT_RENDER_SETTINGS,
      interactionResolutionScale: 0.31,
      maxSubframes: 111,
      tileCount: 5,
      tilesPerFrame: 6,
      exposure: 4.1,
      contrast: 2.3
    };

    const next = resetRenderSettingsGroup(current);
    expect(next.interactionResolutionScale).toBe(DEFAULT_RENDER_SETTINGS.interactionResolutionScale);
    expect(next.maxSubframes).toBe(DEFAULT_RENDER_SETTINGS.maxSubframes);
    expect(next.tileCount).toBe(DEFAULT_RENDER_SETTINGS.tileCount);
    expect(next.tilesPerFrame).toBe(DEFAULT_RENDER_SETTINGS.tilesPerFrame);
    expect(next.exposure).toBe(4.1);
    expect(next.contrast).toBe(2.3);
  });

  test("resets post settings without changing render-group settings", () => {
    const current = {
      ...DEFAULT_RENDER_SETTINGS,
      interactionResolutionScale: 0.31,
      maxSubframes: 111,
      toneMapping: 2,
      exposure: 4.1,
      gamma: 1.8
    };

    const next = resetPostSettingsGroup(current);
    expect(next.toneMapping).toBe(DEFAULT_RENDER_SETTINGS.toneMapping);
    expect(next.exposure).toBe(DEFAULT_RENDER_SETTINGS.exposure);
    expect(next.gamma).toBe(DEFAULT_RENDER_SETTINGS.gamma);
    expect(next.interactionResolutionScale).toBe(0.31);
    expect(next.maxSubframes).toBe(111);
  });

  test("builds uniform defaults with selected preset overrides", () => {
    const values = buildDefaultUniformValuesForPreset({
      uniforms: TEST_UNIFORMS,
      presets: TEST_PRESETS,
      selectedPresetName: "Default"
    });

    expect(values.FOV).toBe(0.75);
    expect(values.Power).toBe(9.5);
    expect(values.Eye).toEqual([1, -1, 0.5]);
  });

  test("resets only the requested uniform group", () => {
    const currentValues = {
      FOV: 0.2,
      Eye: [3, 3, 3],
      Power: 12
    };

    const nextValues = resetUniformGroupValues({
      uniforms: TEST_UNIFORMS,
      presets: TEST_PRESETS,
      selectedPresetName: "Default",
      currentValues,
      groupName: "Camera"
    });

    expect(nextValues.FOV).toBe(0.75);
    expect(nextValues.Eye).toEqual([1, -1, 0.5]);
    expect(nextValues.Power).toBe(12);
  });
});
