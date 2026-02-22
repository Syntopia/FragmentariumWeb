import { resolvePresetUniformValues } from "../core/parser/uniformState";
import type { ParsedPreset, UniformDefinition, UniformValue } from "../core/parser/types";
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from "../core/render/renderer";
import { normalizeUniformGroupName } from "./uniformGroups";

const RENDER_GROUP_KEYS: ReadonlyArray<keyof RenderSettings> = [
  "interactionResolutionScale",
  "maxSubframes",
  "tileCount",
  "tilesPerFrame"
];

const POST_GROUP_KEYS: ReadonlyArray<keyof RenderSettings> = [
  "toneMapping",
  "exposure",
  "gamma",
  "brightness",
  "contrast",
  "saturation"
];

interface BuildDefaultUniformValuesArgs {
  uniforms: UniformDefinition[];
  presets: ParsedPreset[];
  selectedPresetName: string | null;
}

interface ResetUniformGroupValuesArgs extends BuildDefaultUniformValuesArgs {
  currentValues: Record<string, UniformValue>;
  groupName: string;
}

function cloneUniformValue(value: UniformValue): UniformValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  return value;
}

function applyRenderDefaults(
  current: RenderSettings,
  keys: ReadonlyArray<keyof RenderSettings>
): RenderSettings {
  const next = { ...current };
  for (const key of keys) {
    next[key] = DEFAULT_RENDER_SETTINGS[key];
  }
  return next;
}

export function resetRenderSettingsGroup(current: RenderSettings): RenderSettings {
  return applyRenderDefaults(current, RENDER_GROUP_KEYS);
}

export function resetPostSettingsGroup(current: RenderSettings): RenderSettings {
  return applyRenderDefaults(current, POST_GROUP_KEYS);
}

export function buildDefaultUniformValuesForPreset(
  args: BuildDefaultUniformValuesArgs
): Record<string, UniformValue> {
  const nextValues = resolvePresetUniformValues(args.uniforms, args.presets, args.selectedPresetName);

  return Object.fromEntries(
    Object.entries(nextValues).map(([name, value]) => [name, cloneUniformValue(value)])
  );
}

export function resetUniformGroupValues(
  args: ResetUniformGroupValuesArgs
): Record<string, UniformValue> {
  const groupDefaults = buildDefaultUniformValuesForPreset(args);
  const nextValues = { ...args.currentValues };

  for (const uniform of args.uniforms) {
    if (normalizeUniformGroupName(uniform.group) !== args.groupName) {
      continue;
    }
    const value = groupDefaults[uniform.name];
    if (value === undefined) {
      continue;
    }
    nextValues[uniform.name] = cloneUniformValue(value);
  }

  return nextValues;
}
