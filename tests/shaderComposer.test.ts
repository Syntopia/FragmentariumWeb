import { describe, expect, test } from "vitest";
import { buildDisplayShaderSources } from "../src/core/render/shaderComposer";

describe("buildDisplayShaderSources", () => {
  test("uses ACES-like fitted tone mapping for Filmic mode", () => {
    const sources = buildDisplayShaderSources();
    expect(sources.fragmentSource).toContain("toneMapAcesFitted");
    expect(sources.fragmentSource).toContain("const float a = 2.51;");
    expect(sources.fragmentSource).toContain("const float c = 2.43;");
    expect(sources.fragmentSource).toContain("uToneMapping == 3");
  });
});
