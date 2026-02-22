export type UniformType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4";

export type UniformControl = "slider" | "checkbox" | "color";

export type UniformValue = number | boolean | number[];

export interface SourceLineRef {
  path: string;
  line: number;
}

export interface UniformDefinition {
  name: string;
  type: UniformType;
  control: UniformControl;
  group: string;
  min: number[];
  max: number[];
  defaultValue: UniformValue;
  lockType: "locked" | "notlocked" | "notlockable" | "alwayslocked";
  tooltip: string;
}

export interface ParsedPreset {
  name: string;
  values: Record<string, UniformValue>;
  raw: string;
}

export interface ParseResult {
  sourceName: string;
  shaderSource: string;
  shaderLineMap: Array<SourceLineRef | null>;
  uniforms: UniformDefinition[];
  presets: ParsedPreset[];
  cameraMode: "2D" | "3D";
  groups: string[];
}

export interface ParserOptions {
  source: string;
  sourceName: string;
  includeMap: Record<string, string>;
}
