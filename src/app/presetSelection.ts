import type { ParseResult, ParsedPreset } from "../core/parser/types";

export function selectPresetForActivation(
  parseResult: ParseResult,
  preferredPresetName: string | null | undefined
): ParsedPreset | null {
  if (parseResult.presets.length === 0) {
    return null;
  }

  if (preferredPresetName !== undefined && preferredPresetName !== null && preferredPresetName.length > 0) {
    const preferred = parseResult.presets.find((preset) => preset.name === preferredPresetName);
    if (preferred !== undefined) {
      return preferred;
    }
  }

  const namedDefault = parseResult.presets.find((preset) => preset.name.trim().toLowerCase() === "default");
  return namedDefault ?? parseResult.presets[0];
}
