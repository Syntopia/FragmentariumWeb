import type { IntegratorOptionDefinition, IntegratorOptionValues } from "../core/integrators/types";
import { clamp, computeRgbIntensity, normalizeRgbByIntensity, parseHexColorToRgb, rgbToHexColor, scaleRgb, type Rgb } from "../utils/colorUi";

export interface IntegratorSingleOptionRenderItem {
  kind: "single";
  option: IntegratorOptionDefinition;
}

export interface IntegratorColorTripletRenderItem {
  kind: "colorTriplet";
  label: string;
  r: IntegratorOptionDefinition;
  g: IntegratorOptionDefinition;
  b: IntegratorOptionDefinition;
}

export type IntegratorOptionRenderItem = IntegratorSingleOptionRenderItem | IntegratorColorTripletRenderItem;

interface KeySuffixParts {
  base: string;
  channel: "R" | "G" | "B";
}

function parseRgbSuffix(value: string): KeySuffixParts | null {
  const match = /^(.*)(R|G|B)$/.exec(value);
  if (match === null || match[1].length === 0) {
    return null;
  }
  const channel = match[2];
  if (channel !== "R" && channel !== "G" && channel !== "B") {
    return null;
  }
  return {
    base: match[1],
    channel
  };
}

function parseLabelSuffix(label: string): KeySuffixParts | null {
  const match = /^(.*)\s(R|G|B)$/.exec(label.trim());
  if (match === null || match[1].length === 0) {
    return null;
  }
  const channel = match[2];
  if (channel !== "R" && channel !== "G" && channel !== "B") {
    return null;
  }
  return {
    base: match[1],
    channel
  };
}

function canFormColorTriplet(
  r: IntegratorOptionDefinition | undefined,
  g: IntegratorOptionDefinition | undefined,
  b: IntegratorOptionDefinition | undefined
): r is IntegratorOptionDefinition {
  if (r === undefined || g === undefined || b === undefined) {
    return false;
  }
  const rk = parseRgbSuffix(r.key);
  const gk = parseRgbSuffix(g.key);
  const bk = parseRgbSuffix(b.key);
  const rl = parseLabelSuffix(r.label);
  const gl = parseLabelSuffix(g.label);
  const bl = parseLabelSuffix(b.label);
  if (rk === null || gk === null || bk === null || rl === null || gl === null || bl === null) {
    return false;
  }
  if (rk.channel !== "R" || gk.channel !== "G" || bk.channel !== "B") {
    return false;
  }
  if (rl.channel !== "R" || gl.channel !== "G" || bl.channel !== "B") {
    return false;
  }
  if (rk.base !== gk.base || rk.base !== bk.base) {
    return false;
  }
  if (rl.base !== gl.base || rl.base !== bl.base) {
    return false;
  }
  const allScalar =
    !Number.isNaN(r.defaultValue) &&
    !Number.isNaN(g.defaultValue) &&
    !Number.isNaN(b.defaultValue);
  if (!allScalar) {
    return false;
  }
  return true;
}

export function buildIntegratorOptionRenderItems(
  options: IntegratorOptionDefinition[]
): IntegratorOptionRenderItem[] {
  const items: IntegratorOptionRenderItem[] = [];

  for (let index = 0; index < options.length; index += 1) {
    const first = options[index];
    const second = options[index + 1];
    const third = options[index + 2];
    if (canFormColorTriplet(first, second, third)) {
      const labelBase = parseLabelSuffix(first.label)?.base ?? first.label;
      items.push({
        kind: "colorTriplet",
        label: labelBase,
        r: first,
        g: second,
        b: third
      });
      index += 2;
      continue;
    }

    items.push({
      kind: "single",
      option: first
    });
  }

  return items;
}

export function getColorTripletValues(
  triplet: IntegratorColorTripletRenderItem,
  values: IntegratorOptionValues
): Rgb {
  return [
    values[triplet.r.key] ?? triplet.r.defaultValue,
    values[triplet.g.key] ?? triplet.g.defaultValue,
    values[triplet.b.key] ?? triplet.b.defaultValue
  ];
}

export function getColorTripletDefaultValues(triplet: IntegratorColorTripletRenderItem): Rgb {
  return [triplet.r.defaultValue, triplet.g.defaultValue, triplet.b.defaultValue];
}

export function getColorTripletMax(triplet: IntegratorColorTripletRenderItem): number {
  return Math.max(triplet.r.max, triplet.g.max, triplet.b.max);
}

export function supportsHdrColorTripletIntensity(triplet: IntegratorColorTripletRenderItem): boolean {
  return (
    triplet.r.max > 1.000001 ||
    triplet.g.max > 1.000001 ||
    triplet.b.max > 1.000001 ||
    triplet.r.defaultValue > 1.000001 ||
    triplet.g.defaultValue > 1.000001 ||
    triplet.b.defaultValue > 1.000001
  );
}

export function getColorTripletIntensityStep(triplet: IntegratorColorTripletRenderItem): number {
  const steps = [triplet.r.step, triplet.g.step, triplet.b.step]
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry) && entry > 0);
  if (steps.length > 0) {
    return Math.min(...steps);
  }
  const span = Math.max(triplet.r.max, triplet.g.max, triplet.b.max) - Math.min(triplet.r.min, triplet.g.min, triplet.b.min);
  if (span > 100) {
    return 0.1;
  }
  if (span > 10) {
    return 0.01;
  }
  return 0.001;
}

export function getColorTripletDisplayColorHex(
  triplet: IntegratorColorTripletRenderItem,
  values: IntegratorOptionValues
): string {
  const rgb = getColorTripletValues(triplet, values);
  const intensity = computeRgbIntensity(rgb);
  const normalized = normalizeRgbByIntensity(rgb, intensity);
  return rgbToHexColor(normalized);
}

export function getColorTripletIntensity(
  triplet: IntegratorColorTripletRenderItem,
  values: IntegratorOptionValues
): number {
  return computeRgbIntensity(getColorTripletValues(triplet, values));
}

export function getColorTripletDefaultIntensity(triplet: IntegratorColorTripletRenderItem): number {
  return computeRgbIntensity(getColorTripletDefaultValues(triplet));
}

function getFallbackHue(triplet: IntegratorColorTripletRenderItem): Rgb {
  const defaults = getColorTripletDefaultValues(triplet);
  const intensity = computeRgbIntensity(defaults);
  if (intensity > 1e-9) {
    return normalizeRgbByIntensity(defaults, intensity);
  }
  return [1, 1, 1];
}

export function colorTripletPatchFromHex(
  triplet: IntegratorColorTripletRenderItem,
  values: IntegratorOptionValues,
  hex: string
): IntegratorOptionValues {
  const parsed = parseHexColorToRgb(hex);
  if (parsed === null) {
    return {};
  }
  const scaled = supportsHdrColorTripletIntensity(triplet)
    ? scaleRgb(parsed, (() => {
        const currentIntensity = getColorTripletIntensity(triplet, values);
        return currentIntensity > 1e-9 ? currentIntensity : 1;
      })())
    : parsed;
  return {
    [triplet.r.key]: clamp(scaled[0], triplet.r.min, triplet.r.max),
    [triplet.g.key]: clamp(scaled[1], triplet.g.min, triplet.g.max),
    [triplet.b.key]: clamp(scaled[2], triplet.b.min, triplet.b.max)
  };
}

export function colorTripletPatchFromIntensity(
  triplet: IntegratorColorTripletRenderItem,
  values: IntegratorOptionValues,
  nextIntensityRaw: number
): IntegratorOptionValues {
  const nextIntensity = clamp(nextIntensityRaw, 0, getColorTripletMax(triplet));
  const current = getColorTripletValues(triplet, values);
  const currentIntensity = computeRgbIntensity(current);
  const hue = currentIntensity > 1e-9 ? normalizeRgbByIntensity(current, currentIntensity) : getFallbackHue(triplet);
  const scaled = scaleRgb(hue, nextIntensity);
  return {
    [triplet.r.key]: clamp(scaled[0], triplet.r.min, triplet.r.max),
    [triplet.g.key]: clamp(scaled[1], triplet.g.min, triplet.g.max),
    [triplet.b.key]: clamp(scaled[2], triplet.b.min, triplet.b.max)
  };
}
