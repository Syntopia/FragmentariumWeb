export type Vec3 = [number, number, number];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) {
    throw new Error("Cannot normalize zero-length vector.");
  }
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const nAxis = normalize(axis);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const term1 = scale(v, cosA);
  const term2 = scale(cross(nAxis, v), sinA);
  const term3 = scale(nAxis, dot(nAxis, v) * (1 - cosA));
  return add(add(term1, term2), term3);
}
