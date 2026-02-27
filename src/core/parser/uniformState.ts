import type { ParsedPreset, UniformDefinition, UniformValue } from "./types";
import { normalizeDirectionArray } from "../../utils/direction";

export function getDefaultUniformValues(definitions: UniformDefinition[]): Record<string, UniformValue> {
  const values: Record<string, UniformValue> = {};
  for (const definition of definitions) {
    values[definition.name] = cloneUniformValue(definition.defaultValue);
  }
  return values;
}

export function applyPresetValues(
  definitions: UniformDefinition[],
  currentValues: Record<string, UniformValue>,
  preset: ParsedPreset
): Record<string, UniformValue> {
  const next = { ...currentValues };
  const definitionMap = new Map(definitions.map((entry) => [entry.name, entry]));

  for (const [name, rawValue] of Object.entries(preset.values)) {
    const definition = definitionMap.get(name);
    if (definition === undefined) {
      continue;
    }
    next[name] = sanitizeUniformValue(definition, rawValue);
  }

  return next;
}

export function resolvePresetUniformValues(
  definitions: UniformDefinition[],
  presets: ParsedPreset[],
  presetName: string | null
): Record<string, UniformValue> {
  const defaults = getDefaultUniformValues(definitions);
  let next = defaults;
  if (presetName === null) {
    return defaults;
  }

  for (const preset of presets) {
    next = applyPresetValues(definitions, next, preset);
    if (preset.name === presetName) {
      return next;
    }
  }

  return defaults;
}

export function sanitizeUniformValue(
  definition: UniformDefinition,
  value: UniformValue
): UniformValue {
  switch (definition.type) {
    case "bool":
      return Boolean(value);
    case "float":
      return clampNumber(Number(value), definition.min[0], definition.max[0]);
    case "int":
      return Math.round(clampNumber(Number(value), definition.min[0], definition.max[0]));
    case "vec2":
      return sanitizeArray(value, 2, definition.min, definition.max);
    case "vec3": {
      const vector = sanitizeArray(value, 3, definition.min, definition.max);
      if (definition.control === "direction") {
        return normalizeDirectionArray(vector, `Uniform '${definition.name}' direction`);
      }
      return vector;
    }
    case "vec4":
      return sanitizeArray(value, 4, definition.min, definition.max);
    default:
      throw new Error(`Unsupported uniform type: ${definition.type}`);
  }
}

function sanitizeArray(
  value: UniformValue,
  size: number,
  min: number[],
  max: number[]
): number[] {
  if (!Array.isArray(value) || value.length !== size) {
    throw new Error(`Expected array value of size ${size}.`);
  }

  return value.map((entry, index) => clampNumber(Number(entry), min[index], max[index]));
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    throw new Error("Numeric uniform value cannot be NaN.");
  }
  return Math.max(min, Math.min(max, value));
}

function cloneUniformValue(value: UniformValue): UniformValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  return value;
}
