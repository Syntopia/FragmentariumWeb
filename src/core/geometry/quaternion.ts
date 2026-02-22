import { cross, dot, normalize, type Vec3 } from "./vector";

export type Quat = [number, number, number, number]; // [x, y, z, w]

export interface CameraOrientationBasis {
  dir: Vec3;
  up: Vec3;
}

function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(len) || len <= 1e-12) {
    throw new Error("Cannot normalize invalid quaternion.");
  }
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

export function rotateVec3ByQuat(v: Vec3, q: Quat): Vec3 {
  const p: Quat = [v[0], v[1], v[2], 0];
  const rotated = quatMultiply(quatMultiply(q, p), quatConjugate(q));
  return [rotated[0], rotated[1], rotated[2]];
}

export function slerpQuat(a: Quat, b: Quat, tRaw: number): Quat {
  const t = Math.max(0, Math.min(1, tRaw));
  let qa = quatNormalize(a);
  let qb = quatNormalize(b);
  let cosTheta = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];

  if (cosTheta < 0) {
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    cosTheta = -cosTheta;
  }

  if (cosTheta > 0.9995) {
    const out: Quat = [
      qa[0] + t * (qb[0] - qa[0]),
      qa[1] + t * (qb[1] - qa[1]),
      qa[2] + t * (qb[2] - qa[2]),
      qa[3] + t * (qb[3] - qa[3])
    ];
    return quatNormalize(out);
  }

  const theta = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return [
    qa[0] * wa + qb[0] * wb,
    qa[1] * wa + qb[1] * wb,
    qa[2] * wa + qb[2] * wb,
    qa[3] * wa + qb[3] * wb
  ];
}

export function quatFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quat {
  // Column-major rotation matrix with basis vectors as columns.
  const m00 = right[0];
  const m01 = up[0];
  const m02 = forward[0];
  const m10 = right[1];
  const m11 = up[1];
  const m12 = forward[1];
  const m20 = right[2];
  const m21 = up[2];
  const m22 = forward[2];

  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [
      (m21 - m12) / s,
      (m02 - m20) / s,
      (m10 - m01) / s,
      0.25 * s
    ];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [
      0.25 * s,
      (m01 + m10) / s,
      (m02 + m20) / s,
      (m21 - m12) / s
    ];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [
      (m01 + m10) / s,
      0.25 * s,
      (m12 + m21) / s,
      (m02 - m20) / s
    ];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [
      (m02 + m20) / s,
      (m12 + m21) / s,
      0.25 * s,
      (m10 - m01) / s
    ];
  }
  return quatNormalize(q);
}

export function quatFromLookOrientation(dir: Vec3, upHint: Vec3): Quat {
  const forward = normalize(dir);
  // Build a right-handed basis: right x up = forward.
  let right = cross(upHint, forward);
  const rightLen = Math.hypot(right[0], right[1], right[2]);
  if (rightLen <= 1e-8) {
    const fallback: Vec3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    right = cross(fallback, forward);
  }
  right = normalize(right);
  const up = normalize(cross(forward, right));
  return quatFromBasis(right, up, forward);
}

export function basisFromQuat(qRaw: Quat): { right: Vec3; up: Vec3; forward: Vec3 } {
  const q = quatNormalize(qRaw);
  const right = rotateVec3ByQuat([1, 0, 0], q);
  const up = rotateVec3ByQuat([0, 1, 0], q);
  const forward = rotateVec3ByQuat([0, 0, 1], q);
  return {
    right: normalize(right),
    up: normalize(up),
    forward: normalize(forward)
  };
}

export function ensureUpOrthogonalToDir(dirRaw: Vec3, upRaw: Vec3): Vec3 {
  const dir = normalize(dirRaw);
  const projection = dot(upRaw, dir);
  const upProjected: Vec3 = [
    upRaw[0] - dir[0] * projection,
    upRaw[1] - dir[1] * projection,
    upRaw[2] - dir[2] * projection
  ];
  const len = Math.hypot(upProjected[0], upProjected[1], upProjected[2]);
  if (len <= 1e-8) {
    const fallback: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const right = normalize(cross(dir, fallback));
    return normalize(cross(right, dir));
  }
  return [upProjected[0] / len, upProjected[1] / len, upProjected[2] / len];
}
