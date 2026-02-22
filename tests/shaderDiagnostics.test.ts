import { describe, expect, test } from "vitest";
import { formatMappedShaderDiagnostics, mapShaderCompilerDiagnostics, parseShaderCompilerLog } from "../src/core/render/shaderDiagnostics";

describe("shaderDiagnostics", () => {
  test("parses and maps GLSL error lines to source locations", () => {
    const diagnostics = parseShaderCompilerLog(
      "ERROR: 0:12: 'PI' : undeclared identifier\nERROR: 0:14: syntax error"
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].line).toBe(12);

    const mapped = mapShaderCompilerDiagnostics(diagnostics, [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { path: "example.frag", line: 42 },
      null,
      { path: "common.frag", line: 7 }
    ]);

    expect(mapped[0].mappedSource).toEqual({ path: "example.frag", line: 42 });
    expect(mapped[1].mappedSource).toEqual({ path: "common.frag", line: 7 });

    const formatted = formatMappedShaderDiagnostics(mapped);
    expect(formatted).toContain("example.frag:42");
    expect(formatted).toContain("common.frag:7");
  });
});

