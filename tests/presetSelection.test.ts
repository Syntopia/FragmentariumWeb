import { describe, expect, test } from "vitest";
import { selectPresetForActivation } from "../src/app/presetSelection";
import type { ParseResult } from "../src/core/parser/types";

function makeParseResult(presetNames: string[]): ParseResult {
  return {
    sourceName: "test.frag",
    shaderSource: "float DE(vec3 p){return length(p)-1.0;}",
    shaderLineMap: [{ path: "test.frag", line: 1 }],
    uniforms: [],
    presets: presetNames.map((name) => ({ name, values: {}, raw: name })),
    cameraMode: "3D",
    groups: []
  };
}

describe("selectPresetForActivation", () => {
  test("returns null when no presets exist", () => {
    const selected = selectPresetForActivation(makeParseResult([]), undefined);
    expect(selected).toBeNull();
  });

  test("returns preferred preset when it exists", () => {
    const selected = selectPresetForActivation(makeParseResult(["Default", "Closeup"]), "Closeup");
    expect(selected?.name).toBe("Closeup");
  });

  test("falls back to named default when preferred is missing", () => {
    const selected = selectPresetForActivation(makeParseResult(["Overview", " default "]), "Missing");
    expect(selected?.name).toBe(" default ");
  });

  test("falls back to first preset when default is missing", () => {
    const selected = selectPresetForActivation(makeParseResult(["Overview", "Closeup"]), undefined);
    expect(selected?.name).toBe("Overview");
  });
});
