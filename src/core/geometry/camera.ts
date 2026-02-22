import { add, cross, normalize, rotateAroundAxis, scale, sub, type Vec3 } from "./vector";

export interface CameraState {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
}

export interface CameraBasis {
  dir: Vec3;
  right: Vec3;
  upOrtho: Vec3;
}

const DEFAULT_CAMERA: CameraState = {
  eye: [0, 0, -6],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 0.4
};

export class CameraController {
  private state: CameraState = { ...DEFAULT_CAMERA };

  private stepSize = 0.1;

  getState(): CameraState {
    return {
      eye: [...this.state.eye],
      target: [...this.state.target],
      up: [...this.state.up],
      fov: this.state.fov
    };
  }

  setState(next: Partial<CameraState>): void {
    this.state = {
      eye: next.eye ?? this.state.eye,
      target: next.target ?? this.state.target,
      up: next.up ?? this.state.up,
      fov: next.fov ?? this.state.fov
    };
    this.orthogonalizeUp();
  }

  reset(fullReset = true): void {
    this.state = { ...DEFAULT_CAMERA };
    if (fullReset) {
      this.stepSize = 0.1;
    }
  }

  getStepSize(): number {
    return this.stepSize;
  }

  adjustStepSize(multiplier: number): void {
    this.stepSize *= multiplier;
    if (this.stepSize < 1e-6) {
      this.stepSize = 1e-6;
    }
  }

  getBasis(): CameraBasis {
    const dir = this.ensureValidDirection();
    let right = cross(dir, this.state.up);
    const rightLen = vecLen(right);
    if (!Number.isFinite(rightLen) || rightLen <= 1e-8) {
      this.orthogonalizeUp();
      right = cross(dir, this.state.up);
    }
    const rightSafe = normalizeVecWithFallback(
      right,
      Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]),
      [1, 0, 0]
    );
    const upOrtho = normalizeVecWithFallback(cross(rightSafe, dir), [0, 1, 0], [0, 1, 0]);
    return { dir, right: rightSafe, upOrtho };
  }

  updateFromKeys(keys: Set<string>, deltaScale = 1): boolean {
    const basis = this.getBasis();
    const move = this.stepSize * deltaScale;
    const rotate = 0.05 * deltaScale;
    const worldUp: Vec3 = [0, 1, 0];

    let changed = false;

    if (keys.has("a")) {
      this.translate(scale(basis.right, -move));
      changed = true;
    }
    if (keys.has("d")) {
      this.translate(scale(basis.right, move));
      changed = true;
    }
    if (keys.has("w")) {
      this.translate(scale(basis.dir, move));
      changed = true;
    }
    if (keys.has("s")) {
      this.translate(scale(basis.dir, -move));
      changed = true;
    }
    if (keys.has("r")) {
      this.translate(scale(worldUp, -move));
      changed = true;
    }
    if (keys.has("c") || keys.has("f")) {
      this.translate(scale(worldUp, move));
      changed = true;
    }

    if (keys.has("g")) {
      this.rotateCameraAroundOrigin(basis.upOrtho, rotate);
      changed = true;
    }
    if (keys.has("j")) {
      this.rotateCameraAroundOrigin(basis.upOrtho, -rotate);
      changed = true;
    }
    if (keys.has("y")) {
      this.rotateCameraAroundOrigin(basis.right, rotate);
      changed = true;
    }
    if (keys.has("h")) {
      this.rotateCameraAroundOrigin(basis.right, -rotate);
      changed = true;
    }
    if (keys.has("q")) {
      this.roll(-rotate);
      changed = true;
    }
    if (keys.has("e")) {
      this.roll(rotate);
      changed = true;
    }

    if (changed) {
      this.orthogonalizeUp();
    }

    return changed;
  }

  orbitFromDrag(dx: number, dy: number): void {
    const basis = this.getBasis();
    this.orbitAroundEye(basis.upOrtho, -dx * 0.01);
    this.orbitAroundEye(basis.right, -dy * 0.01);
    this.orthogonalizeUp();
  }

  orbitAroundOriginFromDrag(dx: number, dy: number): void {
    const basis = this.getBasis();
    this.rotateCameraAroundOrigin(basis.upOrtho, -dx * 0.01);
    this.rotateCameraAroundOrigin(basis.right, -dy * 0.01);
    this.orthogonalizeUp();
  }

  panFromDrag(dx: number, dy: number): void {
    const basis = this.getBasis();
    const panScale = this.stepSize * 0.08;
    const offset = add(scale(basis.right, -dx * panScale), scale(basis.upOrtho, dy * panScale));
    this.translate(offset);
  }

  dollyFromWheel(deltaY: number, withShift: boolean): void {
    if (withShift) {
      this.adjustStepSize(deltaY < 0 ? 2 : 0.5);
      return;
    }

    const basis = this.getBasis();
    const distance = deltaY < 0 ? this.stepSize : -this.stepSize;
    this.translate(scale(basis.dir, distance));
  }

  zoomFromDrag(dy: number): void {
    const factor = 1 - dy * 0.01;
    const nextFov = this.state.fov * factor;
    this.state.fov = Math.max(0.05, Math.min(2.2, nextFov));
  }

  private orbitAroundEye(axis: Vec3, angle: number): void {
    const direction = sub(this.state.target, this.state.eye);
    const rotated = rotateAroundAxis(direction, axis, angle);
    this.state.target = add(this.state.eye, rotated);
    this.state.up = rotateAroundAxis(this.state.up, axis, angle);
  }

  private roll(angle: number): void {
    const dir = this.ensureValidDirection();
    this.state.up = rotateAroundAxis(this.state.up, dir, angle);
  }

  private rotateCameraAroundOrigin(axis: Vec3, angle: number): void {
    this.state.eye = rotateAroundAxis(this.state.eye, axis, angle);
    this.state.target = rotateAroundAxis(this.state.target, axis, angle);
    this.state.up = rotateAroundAxis(this.state.up, axis, angle);
  }

  private translate(offset: Vec3): void {
    this.state.eye = add(this.state.eye, offset);
    this.state.target = add(this.state.target, offset);
  }

  private orthogonalizeUp(): void {
    const dir = this.ensureValidDirection();
    const upNoDir = sub(this.state.up, scale(dir, dot3(this.state.up, dir)));
    const fallbackAxis: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const fallbackRight = normalizeVecWithFallback(cross(dir, fallbackAxis), [1, 0, 0], [1, 0, 0]);
    const fallbackUp = normalizeVecWithFallback(cross(fallbackRight, dir), [0, 1, 0], [0, 1, 0]);
    this.state.up = normalizeVecWithFallback(upNoDir, fallbackUp, [0, 1, 0]);
  }

  private ensureValidDirection(): Vec3 {
    const dirRaw = sub(this.state.target, this.state.eye);
    const dirLen = vecLen(dirRaw);
    if (Number.isFinite(dirLen) && dirLen > 1e-8) {
      return [dirRaw[0] / dirLen, dirRaw[1] / dirLen, dirRaw[2] / dirLen];
    }

    // Recover from invalid persisted state where eye == target.
    this.state.target = add(this.state.eye, [0, 0, 1]);
    return [0, 0, 1];
  }
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecLen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalizeVecWithFallback(value: Vec3, fallback: Vec3, finalFallback: Vec3): Vec3 {
  const valueLen = vecLen(value);
  if (Number.isFinite(valueLen) && valueLen > 1e-8) {
    return [value[0] / valueLen, value[1] / valueLen, value[2] / valueLen];
  }
  const fallbackLen = vecLen(fallback);
  if (Number.isFinite(fallbackLen) && fallbackLen > 1e-8) {
    return [fallback[0] / fallbackLen, fallback[1] / fallbackLen, fallback[2] / fallbackLen];
  }
  return [...finalFallback];
}
