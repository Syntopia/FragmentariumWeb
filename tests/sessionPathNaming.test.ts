import { describe, expect, test } from "vitest";
import { makeSuffixedSessionPath, makeUniqueSessionPath } from "../src/utils/sessionPathNaming";

describe("sessionPathNaming", () => {
  test("returns original path when unoccupied", () => {
    expect(makeUniqueSessionPath("mandelbulb/my-shot", new Set(["other/path"]))).toBe("mandelbulb/my-shot");
  });

  test("adds numeric suffix for collisions", () => {
    expect(
      makeUniqueSessionPath(
        "mandelbulb/my-shot",
        new Set(["mandelbulb/my-shot", "mandelbulb/my-shot (2)", "mandelbulb/my-shot (3)"])
      )
    ).toBe("mandelbulb/my-shot (4)");
  });

  test("builds suffixed path and validates suffix index", () => {
    expect(makeSuffixedSessionPath("folder/name", 2)).toBe("folder/name (2)");
    expect(() => makeSuffixedSessionPath("folder/name", 1)).toThrow(/>= 2/);
  });
});
