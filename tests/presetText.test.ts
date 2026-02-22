import { describe, expect, test } from "vitest";
import type { UniformDefinition } from "../src/core/parser/types";
import {
  appendPresetBlockToSource,
  buildFragmentariumPresetBlock,
  makeAutoPresetName
} from "../src/app/presetText";

const UNIFORMS: UniformDefinition[] = [
  {
    name: "Detail",
    type: "float",
    control: "slider",
    group: "Raytracer",
    min: [-8],
    max: [2],
    defaultValue: -2.5,
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "UseFog",
    type: "bool",
    control: "checkbox",
    group: "Lighting",
    min: [0],
    max: [1],
    defaultValue: false,
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
    defaultValue: [0, 0, -6],
    lockType: "notlockable",
    tooltip: ""
  }
];

describe("presetText", () => {
  test("builds Fragmentarium preset blocks from current uniform values", () => {
    const block = buildFragmentariumPresetBlock({
      name: "Clipboard/Shared",
      uniforms: UNIFORMS,
      values: {
        Detail: -2.7,
        UseFog: true,
        Eye: [1.5, -2, 3.25]
      }
    });

    expect(block).toBe(`#preset Clipboard/Shared
Detail = -2.7
UseFog = true
Eye = 1.5,-2,3.25
#endpreset
`);
  });

  test("auto-names presets uniquely based on the selected preset", () => {
    expect(makeAutoPresetName(["Default"], "Default")).toBe("Default Copy");
    expect(makeAutoPresetName(["Default Copy"], "Default")).toBe("Default Copy 2");
    expect(makeAutoPresetName([], null)).toBe("Clipboard/Shared");
  });

  test("appends preset blocks to the end of the source with spacing", () => {
    const next = appendPresetBlockToSource("float DE(vec3 p){return 0.0;}\n\n", "#preset A\nX = 1\n#endpreset\n");
    expect(next).toBe(`float DE(vec3 p){return 0.0;}

#preset A
X = 1
#endpreset
`);
  });
});
