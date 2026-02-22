import type { UniformDefinition, UniformValue } from "../core/parser/types";

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Preset values must be finite numbers.");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  return String(value);
}

function formatUniformValue(definition: UniformDefinition, value: UniformValue): string {
  switch (definition.type) {
    case "bool":
      return value ? "true" : "false";
    case "int":
      return String(Math.round(Number(value)));
    case "float":
      return formatNumber(Number(value));
    case "vec2":
    case "vec3":
    case "vec4": {
      if (!Array.isArray(value)) {
        throw new Error(`Uniform '${definition.name}' expected vector value.`);
      }
      return value.map((entry) => formatNumber(Number(entry))).join(",");
    }
    default:
      throw new Error(`Unsupported uniform type '${definition.type}'.`);
  }
}

function sanitizePresetName(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(/\s+/g, " ");
}

export function makeAutoPresetName(existingNames: string[], baseHint?: string | null): string {
  const normalizedExisting = new Set(existingNames.map((entry) => entry.trim().toLowerCase()));
  const cleanedBaseHint = baseHint === undefined || baseHint === null ? "" : baseHint.trim();
  const base = sanitizePresetName(cleanedBaseHint.length > 0 ? `${cleanedBaseHint} Copy` : "Clipboard/Shared");

  if (!normalizedExisting.has(base.toLowerCase())) {
    return base;
  }

  let index = 2;
  while (true) {
    const candidate = `${base} ${index}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
}

export interface BuildPresetBlockArgs {
  name: string;
  uniforms: UniformDefinition[];
  values: Record<string, UniformValue>;
}

export function buildFragmentariumPresetBlock(args: BuildPresetBlockArgs): string {
  const presetName = sanitizePresetName(args.name);
  if (presetName.length === 0) {
    throw new Error("Preset name cannot be empty.");
  }

  const lines = [`#preset ${presetName}`];
  for (const definition of args.uniforms) {
    const value = args.values[definition.name] ?? definition.defaultValue;
    lines.push(`${definition.name} = ${formatUniformValue(definition, value)}`);
  }
  lines.push("#endpreset");
  return `${lines.join("\n")}\n`;
}

export function appendPresetBlockToSource(source: string, presetBlock: string): string {
  const trimmed = source.replace(/\s+$/g, "");
  const normalizedBlock = presetBlock.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s+$/g, "");
  if (trimmed.length === 0) {
    return `${normalizedBlock}\n`;
  }
  return `${trimmed}\n\n${normalizedBlock}\n`;
}
