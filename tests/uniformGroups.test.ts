import { describe, expect, test } from "vitest";
import { getUniformGroupNames, normalizeUniformGroupName } from "../src/app/uniformGroups";
import type { UniformDefinition } from "../src/core/parser/types";

function uniform(name: string, group: string): UniformDefinition {
  return {
    name,
    type: "float",
    control: "slider",
    group,
    min: [0],
    max: [1],
    defaultValue: 0.5,
    lockType: "notlocked",
    tooltip: ""
  };
}

describe("uniformGroups", () => {
  test("normalizes blank group names to Default", () => {
    expect(normalizeUniformGroupName("")).toBe("Default");
    expect(normalizeUniformGroupName("   ")).toBe("Default");
  });

  test("extracts sorted unique group names", () => {
    const groups = getUniformGroupNames([
      uniform("A", "Camera"),
      uniform("B", "Coloring"),
      uniform("C", "Camera"),
      uniform("D", " ")
    ]);
    expect(groups).toEqual(["Camera", "Coloring", "Default"]);
  });
});
