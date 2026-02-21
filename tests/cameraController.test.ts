import { describe, expect, test } from "vitest";
import { CameraController } from "../src/core/geometry/camera";

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("cameraController", () => {
  test("keeps eye fixed when orbiting view direction", () => {
    const controller = new CameraController();
    controller.setState({
      eye: [0, 0, -6],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 0.4
    });

    controller.orbitFromDrag(40, 0);
    const next = controller.getState();
    expect(next.eye).toEqual([0, 0, -6]);
    expect(next.target).not.toEqual([0, 0, 0]);
  });

  test("orbits camera and target around world origin for shift-drag mode", () => {
    const controller = new CameraController();
    controller.setState({
      eye: [0, 0, -6],
      target: [1, 0, 0],
      up: [0, 1, 0],
      fov: 0.4
    });

    const before = controller.getState();
    const beforeEyeRadius = Math.hypot(before.eye[0], before.eye[1], before.eye[2]);
    const beforeTargetRadius = Math.hypot(before.target[0], before.target[1], before.target[2]);

    controller.orbitAroundOriginFromDrag(100, 0);
    const next = controller.getState();
    const nextEyeRadius = Math.hypot(next.eye[0], next.eye[1], next.eye[2]);
    const nextTargetRadius = Math.hypot(next.target[0], next.target[1], next.target[2]);

    expect(next.eye).not.toEqual(before.eye);
    expect(next.target).not.toEqual(before.target);
    expect(nextEyeRadius).toBeCloseTo(beforeEyeRadius, 6);
    expect(nextTargetRadius).toBeCloseTo(beforeTargetRadius, 6);
  });

  test("moves forward and strafe using camera basis vectors", () => {
    const controller = new CameraController();
    controller.setState({
      eye: [0, 0, -6],
      target: [0, 2, 0],
      up: [0, 1, 0],
      fov: 0.4
    });

    const before = controller.getState();
    const movedForward = controller.updateFromKeys(new Set(["w"]), 1);
    expect(movedForward).toBe(true);
    const afterForward = controller.getState();
    expect(afterForward.eye[1]).toBeGreaterThan(before.eye[1]);

    const movedRight = controller.updateFromKeys(new Set(["d"]), 1);
    expect(movedRight).toBe(true);
    const afterRight = controller.getState();
    const basisAfterForward = controller.getBasis();
    const strafeDelta: [number, number, number] = [
      afterRight.eye[0] - afterForward.eye[0],
      afterRight.eye[1] - afterForward.eye[1],
      afterRight.eye[2] - afterForward.eye[2]
    ];
    expect(dot3(strafeDelta, basisAfterForward.right)).toBeGreaterThan(0);
  });
});
