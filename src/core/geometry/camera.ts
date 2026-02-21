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
    const dir = normalize(sub(this.state.target, this.state.eye));
    const right = normalize(cross(dir, this.state.up));
    const upOrtho = normalize(sub(this.state.up, scale(dir, dot3(this.state.up, dir))));
    return { dir, right, upOrtho };
  }

  updateFromKeys(keys: Set<string>, deltaScale = 1): boolean {
    const basis = this.getBasis();
    const move = this.stepSize * deltaScale;
    const rotate = 0.05 * deltaScale;
    const worldUp: Vec3 = [0, 1, 0];

    const planarDir: Vec3 = [basis.dir[0], 0, basis.dir[2]];
    const hasPlanarDir = Math.abs(planarDir[0]) + Math.abs(planarDir[2]) > 1e-8;
    const fpsForward = hasPlanarDir ? normalize(planarDir) : basis.dir;
    const fpsRight = hasPlanarDir ? normalize(cross(worldUp, fpsForward)) : basis.right;

    let changed = false;

    if (keys.has("a")) {
      this.translate(scale(fpsRight, -move));
      changed = true;
    }
    if (keys.has("d")) {
      this.translate(scale(fpsRight, move));
      changed = true;
    }
    if (keys.has("w")) {
      this.translate(scale(fpsForward, move));
      changed = true;
    }
    if (keys.has("s")) {
      this.translate(scale(fpsForward, -move));
      changed = true;
    }
    if (keys.has("r")) {
      this.translate(scale(worldUp, -move));
      changed = true;
    }
    if (keys.has("f")) {
      this.translate(scale(worldUp, move));
      changed = true;
    }

    if (keys.has("y")) {
      this.orbitAroundEye(basis.upOrtho, rotate);
      changed = true;
    }
    if (keys.has("h")) {
      this.orbitAroundEye(basis.upOrtho, -rotate);
      changed = true;
    }
    if (keys.has("t")) {
      this.orbitAroundEye(basis.right, rotate);
      changed = true;
    }
    if (keys.has("g")) {
      this.orbitAroundEye(basis.right, -rotate);
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
    const dir = normalize(sub(this.state.target, this.state.eye));
    this.state.up = rotateAroundAxis(this.state.up, dir, angle);
  }

  private translate(offset: Vec3): void {
    this.state.eye = add(this.state.eye, offset);
    this.state.target = add(this.state.target, offset);
  }

  private orthogonalizeUp(): void {
    const dir = normalize(sub(this.state.target, this.state.eye));
    const upNoDir = sub(this.state.up, scale(dir, dot3(this.state.up, dir)));
    this.state.up = normalize(upNoDir);
  }
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
