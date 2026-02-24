import { describe, expect, it } from "vitest";

// @ts-expect-error TS7016: local Node build script module has no TS types; runtime import is intentional for test coverage.
import { formatBuildVersion, incrementBuildVersionString, parseBuildVersionString } from "../scripts/buildVersionUtils.mjs";

describe("buildVersionUtils", () => {
  it("parses a strict x.y.z version string", () => {
    expect(parseBuildVersionString("0.9.234")).toEqual({
      major: 0,
      minor: 9,
      patch: 234
    });
  });

  it("increments the lowest version part", () => {
    expect(incrementBuildVersionString("0.9.234")).toBe("0.9.235");
  });

  it("formats version parts back to x.y.z", () => {
    expect(formatBuildVersion({ major: 2, minor: 0, patch: 5 })).toBe("2.0.5");
  });

  it("fails explicitly on malformed input", () => {
    expect(() => parseBuildVersionString("0.9")).toThrow("Expected format 'x.y.z'");
    expect(() => parseBuildVersionString("v1.2.3")).toThrow("Expected format 'x.y.z'");
  });
});
