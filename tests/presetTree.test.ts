import { describe, expect, test } from "vitest";
import { buildPresetTree } from "../src/core/presets/presetTree";

describe("buildPresetTree", () => {
  test("creates hierarchical nodes from slash-separated preset names", () => {
    const tree = buildPresetTree([
      { name: "Default", values: {}, raw: "" },
      { name: "Cameras/Wide", values: {}, raw: "" },
      { name: "Cameras/Close", values: {}, raw: "" },
      { name: "Colors/Warm", values: {}, raw: "" }
    ]);

    expect(tree).toHaveLength(3);
    const cameras = tree.find((entry) => entry.name === "Cameras");
    expect(cameras).toBeDefined();
    expect(cameras?.children.map((entry) => entry.name)).toEqual(["Wide", "Close"]);
  });
});
