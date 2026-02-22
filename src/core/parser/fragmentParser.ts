import type {
  ParseResult,
  ParserOptions,
  ParsedPreset,
  SourceLineRef,
  UniformControl,
  UniformDefinition,
  UniformType,
  UniformValue,
} from "./types";

const GROUP_DIRECTIVE = /^\s*#group\s+(.+)\s*$/i;
const CAMERA_DIRECTIVE = /^\s*#camera\s+(.+)\s*$/i;
const PRESET_START = /^\s*#preset\s+(.+)\s*$/i;
const PRESET_END = /^\s*#endpreset\s*$/i;
const INCLUDE_DIRECTIVE = /^\s*#include\s+"([^"]+)"\s*$/i;
const VERTEX_START = /^\s*#vertex\s*$/i;
const VERTEX_END = /^\s*#endvertex\s*$/i;
const PRESERVED_PREPROCESSOR_DIRECTIVES = new Set([
  "define",
  "undef",
  "if",
  "ifdef",
  "ifndef",
  "elif",
  "else",
  "endif",
  "pragma",
  "extension",
  "line"
]);

interface ParsedUniform {
  definition: UniformDefinition;
  shaderLine: string;
}

interface GlobalUniformDependentInitializer {
  declarationLine: string;
  assignmentLines: string[];
}

interface ExpandedSourceLine {
  text: string;
  origin: SourceLineRef;
}

const lockTypes = new Set(["locked", "notlocked", "notlockable", "alwayslocked"]);

function toLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}

function isPreservedPreprocessorDirective(line: string): boolean {
  const directive = line.match(/^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (directive === null) {
    return false;
  }
  return PRESERVED_PREPROCESSOR_DIRECTIVES.has(directive[1].toLowerCase());
}

function braceDelta(line: string): number {
  return (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
}

function gatherUniformNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const match = line.match(
      /^\s*uniform\s+(?:float|int|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|uvec2|uvec3|uvec4|bvec2|bvec3|bvec4|mat2|mat3|mat4|mat2x2|mat2x3|mat2x4|mat3x2|mat3x3|mat3x4|mat4x2|mat4x3|mat4x4|uint|sampler2D|samplerCube)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/
    );
    if (match !== null) {
      names.add(match[1]);
    }
  }
  return names;
}

function parseGlobalUniformDependentInitializer(
  line: string,
  uniformNames: Set<string>
): GlobalUniformDependentInitializer | null {
  const match = line.match(
    /^(\s*)((?:highp|mediump|lowp)\s+)?(float|int|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|uvec2|uvec3|uvec4|bvec2|bvec3|bvec4|mat2|mat3|mat4|mat2x2|mat2x3|mat2x4|mat3x2|mat3x3|mat3x4|mat4x2|mat4x3|mat4x4|uint)\s+(.+);\s*$/
  );
  if (match === null) {
    return null;
  }

  const indent = match[1];
  const precision = match[2] ?? "";
  const type = match[3];
  const declaratorBody = match[4];
  const declarators = splitTopLevelComma(declaratorBody).map((entry) => entry.trim());
  if (declarators.length === 0) {
    return null;
  }

  const parsedDeclarators = declarators.map((entry) => {
    const declaratorMatch = entry.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/);
    if (declaratorMatch === null) {
      return null;
    }
    return {
      name: declaratorMatch[1],
      initializer: declaratorMatch[2]?.trim() ?? null
    };
  });
  if (parsedDeclarators.some((entry) => entry === null)) {
    return null;
  }

  const variables = parsedDeclarators as Array<{ name: string; initializer: string | null }>;
  const usesUniform = variables.some(
    (entry) =>
      entry.initializer !== null &&
      [...uniformNames].some((uniformName) => new RegExp(`\\b${uniformName}\\b`).test(entry.initializer!))
  );
  if (!usesUniform) {
    return null;
  }

  const declarationNames = variables.map((entry) => entry.name).join(", ");
  const assignmentLines = variables
    .filter((entry) => entry.initializer !== null)
    .map((entry) => `${indent}${entry.name} = ${entry.initializer};`);

  return {
    declarationLine: `${indent}${precision}${type} ${declarationNames};`,
    assignmentLines
  };
}

function parseFallbackUniformShaderLine(line: string): string | null {
  const match = line.match(/^(\s*uniform\s+[A-Za-z_][A-Za-z0-9_]*\s+[^;]+;)\s*.*$/);
  if (match === null) {
    return null;
  }
  return match[1].trimEnd();
}

function parseLockType(raw: string | undefined): UniformDefinition["lockType"] {
  if (raw === undefined || raw.trim() === "") {
    return "notlocked";
  }
  const normalized = raw.trim().toLowerCase();
  if (!lockTypes.has(normalized)) {
    throw new Error(`Invalid lock type: ${raw}`);
  }
  return normalized as UniformDefinition["lockType"];
}

function parseNumber(raw: string): number {
  const trimmed = raw.trim();
  const numericPrefix = trimmed.match(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
  if (numericPrefix !== null) {
    const value = Number(numericPrefix[0]);
    if (!Number.isNaN(value)) {
      return value;
    }
  }
  const value = Number(trimmed);
  if (Number.isNaN(value)) {
    throw new Error(`Unable to parse number: ${raw}`);
  }
  return value;
}

function splitTopLevelComma(input: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new Error(`Unbalanced parentheses in: ${input}`);
      }
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced parentheses in: ${input}`);
  }
  result.push(current.trim());
  return result.filter((part) => part.length > 0);
}

function parseTuple(raw: string, size: number): number[] {
  const match = raw.match(/^\((.*)\)$/);
  if (match === null) {
    throw new Error(`Expected tuple expression, got: ${raw}`);
  }
  const parts = splitTopLevelComma(match[1]);
  if (parts.length !== size) {
    throw new Error(`Expected tuple of size ${size}, got: ${raw}`);
  }
  return parts.map(parseNumber);
}

function parseUniformValue(raw: string): UniformValue {
  const value = raw.trim();
  if (value.includes(",")) {
    return value.split(",").map((part) => parseNumber(part));
  }
  const lower = value.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }
  return parseNumber(value);
}

function parsePresetBlock(name: string, lines: string[]): ParsedPreset {
  const values: Record<string, UniformValue> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) {
      continue;
    }
    const pair = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (pair === null) {
      throw new Error(`Invalid preset line in '${name}': ${line}`);
    }
    try {
      values[pair[1]] = parseUniformValue(pair[2]);
    } catch {
      // Legacy presets may contain non-numeric values (e.g. texture paths) that are irrelevant
      // for our current DE-only parser/runtime. Keep parsing and skip unsupported assignments.
    }
  }
  return {
    name,
    values,
    raw: lines.join("\n")
  };
}

function parseAnnotatedUniform(
  line: string,
  currentGroup: string,
  tooltip: string
): ParsedUniform | null {
  const uniformHeader = line.match(/^\s*uniform\s+(float|int|bool|vec2|vec3|vec4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;\s*(.*)$/);
  if (uniformHeader === null) {
    return null;
  }

  const type = uniformHeader[1] as UniformType;
  const name = uniformHeader[2];
  const trailing = uniformHeader[3].trim();
  const defaultGroup = currentGroup === "" ? "Default" : currentGroup;

  const makeBase = (
    control: UniformControl,
    min: number[],
    max: number[],
    defaultValue: UniformValue,
    lockRaw: string | undefined
  ): ParsedUniform => ({
    definition: {
      name,
      type,
      control,
      group: defaultGroup,
      min,
      max,
      defaultValue,
      lockType: parseLockType(lockRaw),
      tooltip
    },
    shaderLine: `uniform ${type} ${name};`
  });

  if (trailing.startsWith("slider[")) {
    const sliderMatch = trailing.match(/^slider\[(.*)\]\s*([A-Za-z]+)?\s*.*$/i);
    if (sliderMatch === null) {
      throw new Error(`Invalid slider annotation: ${line}`);
    }
    const parts = splitTopLevelComma(sliderMatch[1]);
    if (type === "float" || type === "int") {
      if (parts.length !== 3) {
        throw new Error(`Invalid scalar slider annotation: ${line}`);
      }
      const from = parseNumber(parts[0]);
      const defaultValue = parseNumber(parts[1]);
      const to = parseNumber(parts[2]);
      return makeBase(
        "slider",
        [from],
        [to],
        type === "int" ? Math.trunc(defaultValue) : defaultValue,
        sliderMatch[2]
      );
    }

    const tupleSize = type === "vec2" ? 2 : type === "vec3" ? 3 : 4;
    if (parts.length !== 3) {
      throw new Error(`Invalid vector slider annotation: ${line}`);
    }
    const from = parseTuple(parts[0], tupleSize);
    const defaultTuple = parseTuple(parts[1], tupleSize);
    const to = parseTuple(parts[2], tupleSize);
    return makeBase("slider", from, to, defaultTuple, sliderMatch[2]);
  }

  if (trailing.startsWith("checkbox[")) {
    if (type !== "bool") {
      throw new Error(`checkbox[] only supports bool uniforms: ${line}`);
    }
    const checkMatch = trailing.match(/^checkbox\[(true|false)\]\s*([A-Za-z]+)?\s*.*$/i);
    if (checkMatch === null) {
      throw new Error(`Invalid checkbox annotation: ${line}`);
    }
    const value = checkMatch[1].toLowerCase() === "true";
    return makeBase("checkbox", [0], [1], value, checkMatch[2]);
  }

  if (trailing.startsWith("color[")) {
    const colorMatch = trailing.match(/^color\[(.*)\]\s*([A-Za-z]+)?\s*.*$/i);
    if (colorMatch === null) {
      throw new Error(`Invalid color annotation: ${line}`);
    }
    const parts = splitTopLevelComma(colorMatch[1]);
    if (type === "vec3") {
      if (parts.length !== 3) {
        throw new Error(`vec3 color[] must have 3 values: ${line}`);
      }
      const color = parts.map(parseNumber);
      return makeBase("color", [0, 0, 0], [1, 1, 1], color, colorMatch[2]);
    }
    if (type === "vec4") {
      if (parts.length !== 6) {
        throw new Error(`vec4 color[] must have 6 values: ${line}`);
      }
      const from = parseNumber(parts[0]);
      const defaultAlpha = parseNumber(parts[1]);
      const to = parseNumber(parts[2]);
      const rgb = [parseNumber(parts[3]), parseNumber(parts[4]), parseNumber(parts[5])];
      return makeBase(
        "color",
        [0, 0, 0, from],
        [1, 1, 1, to],
        [rgb[0], rgb[1], rgb[2], defaultAlpha],
        colorMatch[2]
      );
    }
    throw new Error(`color[] only supports vec3/vec4 uniforms: ${line}`);
  }

  if (trailing.startsWith("//")) {
    return null;
  }

  if (trailing === "") {
    return null;
  }

  throw new Error(`Unsupported uniform annotation: ${line}`);
}

function expandIncludesToLines(
  source: string,
  sourceName: string,
  includeMap: Record<string, string>,
  includeStack: string[]
): ExpandedSourceLine[] {
  const lines = toLines(source);
  const expanded: ExpandedSourceLine[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const origin: SourceLineRef = {
      path: sourceName,
      line: lineIndex + 1
    };
    const includeMatch = line.match(INCLUDE_DIRECTIVE);
    if (includeMatch === null) {
      expanded.push({ text: line, origin });
      continue;
    }

    const includeName = includeMatch[1];
    const includeSource = includeMap[includeName];
    if (includeSource === undefined) {
      throw new Error(`Include not found from '${sourceName}': ${includeName}`);
    }
    if (includeStack.includes(includeName)) {
      throw new Error(`Cyclic include detected: ${includeStack.join(" -> ")} -> ${includeName}`);
    }

    expanded.push({ text: `// #include \"${includeName}\"`, origin });
    expanded.push(...expandIncludesToLines(includeSource, includeName, includeMap, [...includeStack, includeName]));
    expanded.push({ text: `// #endinclude \"${includeName}\"`, origin });
  }

  return expanded;
}

export function parseFragmentSource(options: ParserOptions): ParseResult {
  const expandedLines = expandIncludesToLines(options.source, options.sourceName, options.includeMap, [options.sourceName]);
  const lines = expandedLines.map((entry) => entry.text);
  const uniformNames = gatherUniformNames(lines);

  const outputLines: string[] = [];
  const shaderLineMap: Array<SourceLineRef | null> = [];
  const uniforms: UniformDefinition[] = [];
  const presets: ParsedPreset[] = [];
  const groups = new Set<string>();
  const globalInitAssignments: string[] = [];

  let cameraMode: "2D" | "3D" = "3D";
  let currentGroup = "Default";
  let inVertexBlock = false;
  let lastComment = "";
  let shaderScopeDepth = 0;
  const pushOutputLine = (line: string, origin: SourceLineRef | null): void => {
    outputLines.push(line);
    shaderLineMap.push(origin);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineOrigin = expandedLines[i]?.origin ?? null;
    const trimmed = line.trim();

    if (VERTEX_START.test(trimmed)) {
      inVertexBlock = true;
      continue;
    }
    if (VERTEX_END.test(trimmed)) {
      inVertexBlock = false;
      continue;
    }
    if (inVertexBlock) {
      continue;
    }

    const presetStartMatch = line.match(PRESET_START);
    if (presetStartMatch !== null) {
      const name = presetStartMatch[1].trim();
      const presetLines: string[] = [];
      let foundEnd = false;
      i += 1;
      while (i < lines.length) {
        const presetLine = lines[i];
        if (PRESET_END.test(presetLine.trim())) {
          foundEnd = true;
          break;
        }
        presetLines.push(presetLine);
        i += 1;
      }
      if (!foundEnd) {
        throw new Error(`Missing #endpreset for preset '${name}'.`);
      }
      presets.push(parsePresetBlock(name, presetLines));
      continue;
    }

    const groupMatch = line.match(GROUP_DIRECTIVE);
    if (groupMatch !== null) {
      currentGroup = groupMatch[1].trim();
      groups.add(currentGroup);
      continue;
    }

    const cameraMatch = line.match(CAMERA_DIRECTIVE);
    if (cameraMatch !== null) {
      const normalized = cameraMatch[1].trim().toUpperCase();
      cameraMode = normalized === "2D" ? "2D" : "3D";
      continue;
    }

    if (trimmed.startsWith("#buffer") || trimmed.startsWith("#buffershader")) {
      continue;
    }

    const parsedUniform = parseAnnotatedUniform(line, currentGroup, lastComment);
    if (parsedUniform !== null) {
      uniforms.push(parsedUniform.definition);
      pushOutputLine(parsedUniform.shaderLine, lineOrigin);
      shaderScopeDepth += braceDelta(parsedUniform.shaderLine);
      lastComment = "";
      continue;
    }

    const fallbackUniformShaderLine = parseFallbackUniformShaderLine(line);
    if (fallbackUniformShaderLine !== null) {
      pushOutputLine(fallbackUniformShaderLine, lineOrigin);
      shaderScopeDepth += braceDelta(fallbackUniformShaderLine);
      lastComment = "";
      continue;
    }

    if (trimmed.startsWith("#")) {
      if (isPreservedPreprocessorDirective(trimmed)) {
        pushOutputLine(line, lineOrigin);
        shaderScopeDepth += braceDelta(line);
      }
      continue;
    }

    if (shaderScopeDepth === 0) {
      const transformed = parseGlobalUniformDependentInitializer(line, uniformNames);
      if (transformed !== null) {
        pushOutputLine(transformed.declarationLine, lineOrigin);
        for (const assignmentLine of transformed.assignmentLines) {
          globalInitAssignments.push(assignmentLine.trim());
        }
        shaderScopeDepth += braceDelta(transformed.declarationLine);
        if (trimmed.startsWith("//")) {
          lastComment = trimmed.replace(/^\/\//, "").trim();
        } else {
          lastComment = "";
        }
        continue;
      }
    }

    pushOutputLine(line, lineOrigin);
    shaderScopeDepth += braceDelta(line);

    if (trimmed.startsWith("//")) {
      lastComment = trimmed.replace(/^\/\//, "").trim();
    } else {
      lastComment = "";
    }
  }

  if (globalInitAssignments.length > 0) {
    pushOutputLine("", null);
    pushOutputLine("#define HAS_FRAGMENTARIUM_WEB_INIT_GLOBALS 1", null);
    pushOutputLine("void fragmentariumWebInitGlobalsImpl() {", null);
    for (const assignment of globalInitAssignments) {
      pushOutputLine(`  ${assignment}`, null);
    }
    pushOutputLine("}", null);
  }

  groups.add("Default");
  return {
    sourceName: options.sourceName,
    shaderSource: outputLines.join("\n"),
    shaderLineMap,
    uniforms,
    presets,
    cameraMode,
    groups: [...groups]
  };
}
