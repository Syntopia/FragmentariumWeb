export type Rgb = [number, number, number];

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function rgbToHexColor(rgb: Rgb): string {
  const toHex = (value: number): string => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

export function parseHexColorToRgb(colorHex: string): Rgb | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(colorHex);
  if (match === null) {
    return null;
  }
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ];
}

export function computeRgbIntensity(rgb: Rgb): number {
  return Math.max(rgb[0], rgb[1], rgb[2], 0);
}

export function normalizeRgbByIntensity(rgb: Rgb, intensityRaw: number): Rgb {
  const intensity = Math.max(intensityRaw, 0);
  if (intensity <= 1e-9) {
    return [0, 0, 0];
  }
  return [rgb[0] / intensity, rgb[1] / intensity, rgb[2] / intensity];
}

export function scaleRgb(rgb: Rgb, factor: number): Rgb {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor];
}

export function clampRgb(rgb: Rgb, min: number, max: number): Rgb {
  return [
    clamp(rgb[0], min, max),
    clamp(rgb[1], min, max),
    clamp(rgb[2], min, max)
  ];
}

