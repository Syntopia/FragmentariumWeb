import type { SourceLineRef } from "../parser/types";

export interface ShaderCompilerDiagnostic {
  severity: "error" | "warning" | "info";
  sourceString: number | null;
  line: number | null;
  message: string;
  rawLine: string;
}

export interface MappedShaderCompilerDiagnostic extends ShaderCompilerDiagnostic {
  mappedSource: SourceLineRef | null;
}

const GLSL_ERROR_LINE_RE = /^(ERROR|WARNING)\s*:\s*(\d+)\s*:\s*(\d+)\s*:\s*(.*)$/i;

export function parseShaderCompilerLog(log: string): ShaderCompilerDiagnostic[] {
  return log
    .split(/\r\n|\r|\n/)
    .map((rawLine) => rawLine.trim())
    .filter((rawLine) => rawLine.length > 0)
    .map((rawLine) => {
      const match = rawLine.match(GLSL_ERROR_LINE_RE);
      if (match === null) {
        return {
          severity: "info" as const,
          sourceString: null,
          line: null,
          message: rawLine,
          rawLine
        };
      }
      return {
        severity: match[1].toUpperCase() === "WARNING" ? ("warning" as const) : ("error" as const),
        sourceString: Number(match[2]),
        line: Number(match[3]),
        message: match[4].trim(),
        rawLine
      };
    });
}

export function mapShaderCompilerDiagnostics(
  diagnostics: ShaderCompilerDiagnostic[],
  fragmentLineMap: Array<SourceLineRef | null> | undefined
): MappedShaderCompilerDiagnostic[] {
  if (fragmentLineMap === undefined) {
    return diagnostics.map((entry) => ({ ...entry, mappedSource: null }));
  }
  return diagnostics.map((entry) => {
    const mappedSource =
      entry.line !== null && entry.line >= 1 && entry.line <= fragmentLineMap.length
        ? fragmentLineMap[entry.line - 1] ?? null
        : null;
    return {
      ...entry,
      mappedSource
    };
  });
}

export function formatMappedShaderDiagnostics(diagnostics: MappedShaderCompilerDiagnostic[]): string {
  return diagnostics
    .map((entry) => {
      const prefix =
        entry.mappedSource !== null
          ? `${entry.mappedSource.path}:${entry.mappedSource.line}`
          : entry.line !== null
            ? `GLSL:${entry.line}`
            : "GLSL";
      return `${prefix}: ${entry.message}`;
    })
    .join("\n");
}

