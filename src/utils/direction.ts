const DIRECTION_EPSILON = 1.0e-6;

function ensureFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeDirectionComponents(
  x: number,
  y: number,
  z: number,
  label = "Direction"
): [number, number, number] {
  const nx = ensureFiniteNumber(x, `${label}.x`);
  const ny = ensureFiniteNumber(y, `${label}.y`);
  const nz = ensureFiniteNumber(z, `${label}.z`);
  const length = Math.hypot(nx, ny, nz);
  if (length <= DIRECTION_EPSILON) {
    throw new Error(`${label} must be a non-zero vector.`);
  }
  return [nx / length, ny / length, nz / length];
}

export function normalizeDirectionArray(
  value: readonly number[],
  label = "Direction"
): [number, number, number] {
  if (value.length !== 3) {
    throw new Error(`${label} must have exactly 3 components.`);
  }
  return normalizeDirectionComponents(value[0], value[1], value[2], label);
}

export function clampDirectionComponents(value: readonly number[]): [number, number, number] {
  if (value.length !== 3) {
    throw new Error("Direction must have exactly 3 components.");
  }
  return [
    clamp(Number(value[0]), -1, 1),
    clamp(Number(value[1]), -1, 1),
    clamp(Number(value[2]), -1, 1)
  ];
}
