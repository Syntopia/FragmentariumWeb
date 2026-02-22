import { describe, expect, test } from "vitest";
import type { CameraState } from "../src/core/geometry/camera";
import type { UniformDefinition } from "../src/core/parser/types";
import {
  applyInterpolationMode,
  buildChangedCameraSummaries,
  buildChangedUniformSummaries,
  buildInterpolatedExportState,
  interpolateCameraState
} from "../src/app/exportInterpolation";

const UNIFORMS: UniformDefinition[] = [
  {
    name: "Detail",
    type: "float",
    control: "slider",
    group: "Raytracer",
    min: [-10],
    max: [10],
    defaultValue: -2.5,
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Toggle",
    type: "bool",
    control: "checkbox",
    group: "Raytracer",
    min: [0],
    max: [1],
    defaultValue: false,
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Color",
    type: "vec3",
    control: "color",
    group: "Coloring",
    min: [0, 0, 0],
    max: [1, 1, 1],
    defaultValue: [1, 1, 1],
    lockType: "notlockable",
    tooltip: ""
  }
];

const CAMERA_UNIFORMS: UniformDefinition[] = [
  {
    name: "Eye",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-20, -20, -20],
    max: [20, 20, 20],
    defaultValue: [0, 0, -6],
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Target",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-20, -20, -20],
    max: [20, 20, 20],
    defaultValue: [0, 0, 0],
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Up",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-1, -1, -1],
    max: [1, 1, 1],
    defaultValue: [0, 1, 0],
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "FOV",
    type: "float",
    control: "slider",
    group: "Camera",
    min: [0.1],
    max: [1.5],
    defaultValue: 0.4,
    lockType: "notlockable",
    tooltip: ""
  }
];

const CAMERA_A: CameraState = {
  eye: [0, 0, -6],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 0.4
};

const CAMERA_B: CameraState = {
  eye: [2, 1, -4],
  target: [0.5, 0.25, 0],
  up: [0.1, 1, 0],
  fov: 0.7
};

describe("exportInterpolation", () => {
  test("applies smoothstep easing", () => {
    expect(applyInterpolationMode("linear", 0.5)).toBe(0.5);
    expect(applyInterpolationMode("ease-in-out", 0.5)).toBeCloseTo(0.5);
    expect(applyInterpolationMode("ease-in-out", 0.25)).toBeCloseTo(0.15625);
  });

  test("builds changed summaries and skips constants", () => {
    const changes = buildChangedUniformSummaries(
      UNIFORMS,
      { Detail: -2.5, Toggle: false, Color: [1, 0, 0] },
      { Detail: -2.1, Toggle: false, Color: [1, 0.5, 0] }
    );
    expect(changes.map((entry) => entry.name)).toEqual(["Detail", "Color"]);

    const cameraChanges = buildChangedCameraSummaries(CAMERA_A, CAMERA_B);
    expect(cameraChanges.map((entry) => entry.name)).toContain("Eye");
    expect(cameraChanges.map((entry) => entry.name)).toContain("FOV");
  });

  test("skips camera uniforms in uniform changed summaries", () => {
    const changes = buildChangedUniformSummaries(
      [...CAMERA_UNIFORMS, ...UNIFORMS],
      {
        Eye: [0, 0, -6],
        Target: [0, 0, 0],
        Up: [0, 1, 0],
        FOV: 0.4,
        Detail: -2.5,
        Toggle: false,
        Color: [1, 0, 0]
      },
      {
        Eye: [2, 1, -4],
        Target: [0.5, 0.25, 0],
        Up: [0.1, 1, 0],
        FOV: 0.7,
        Detail: -2.2,
        Toggle: false,
        Color: [1, 0.5, 0]
      }
    );
    expect(changes.map((entry) => entry.name)).toEqual(["Detail", "Color"]);
  });

  test("interpolates uniforms and keeps bool at initial value", () => {
    const state = buildInterpolatedExportState({
      frameIndex: 1,
      frameCount: 3,
      interpolation: "linear",
      uniformDefinitions: UNIFORMS,
      startUniformValues: { Detail: -3, Toggle: false, Color: [0, 0, 0] },
      endUniformValues: { Detail: -1, Toggle: true, Color: [1, 0.5, 0.25] },
      startCamera: CAMERA_A,
      endCamera: CAMERA_B
    });
    expect(state.uniformValues.Detail).toBeCloseTo(-2);
    expect(state.uniformValues.Toggle).toBe(false);
    expect(state.uniformValues.Color).toEqual([0.5, 0.25, 0.125]);
  });

  test("interpolates camera while preserving orthogonal up", () => {
    const mid = interpolateCameraState(CAMERA_A, CAMERA_B, 0.5);
    expect(mid.fov).toBeCloseTo(0.55);
    const dir = [
      mid.target[0] - mid.eye[0],
      mid.target[1] - mid.eye[1],
      mid.target[2] - mid.eye[2]
    ];
    const dot = dir[0] * mid.up[0] + dir[1] * mid.up[1] + dir[2] * mid.up[2];
    expect(Math.abs(dot)).toBeLessThan(1e-4);
  });

  test("preserves exact camera endpoints", () => {
    expect(interpolateCameraState(CAMERA_A, CAMERA_B, 0)).toEqual(CAMERA_A);
    expect(interpolateCameraState(CAMERA_A, CAMERA_B, 1)).toEqual(CAMERA_B);
  });

  test("keeps identical camera unchanged for intermediate t", () => {
    const mid = interpolateCameraState(CAMERA_B, CAMERA_B, 0.5);
    expect(mid.eye[0]).toBeCloseTo(CAMERA_B.eye[0], 6);
    expect(mid.eye[1]).toBeCloseTo(CAMERA_B.eye[1], 6);
    expect(mid.eye[2]).toBeCloseTo(CAMERA_B.eye[2], 6);
    expect(mid.target[0]).toBeCloseTo(CAMERA_B.target[0], 6);
    expect(mid.target[1]).toBeCloseTo(CAMERA_B.target[1], 6);
    expect(mid.target[2]).toBeCloseTo(CAMERA_B.target[2], 6);
    expect(mid.up[0]).toBeCloseTo(CAMERA_B.up[0], 6);
    expect(mid.up[1]).toBeCloseTo(CAMERA_B.up[1], 6);
    expect(mid.up[2]).toBeCloseTo(CAMERA_B.up[2], 6);
    expect(mid.fov).toBeCloseTo(CAMERA_B.fov, 6);
  });

  test("keeps camera uniforms aligned with interpolated camera", () => {
    const state = buildInterpolatedExportState({
      frameIndex: 1,
      frameCount: 3,
      interpolation: "linear",
      uniformDefinitions: [...CAMERA_UNIFORMS, ...UNIFORMS],
      startUniformValues: {
        Eye: [...CAMERA_A.eye],
        Target: [...CAMERA_A.target],
        Up: [...CAMERA_A.up],
        FOV: CAMERA_A.fov,
        Detail: -3,
        Toggle: false,
        Color: [0, 0, 0]
      },
      endUniformValues: {
        Eye: [...CAMERA_B.eye],
        Target: [...CAMERA_B.target],
        Up: [...CAMERA_B.up],
        FOV: CAMERA_B.fov,
        Detail: -1,
        Toggle: true,
        Color: [1, 0.5, 0.25]
      },
      startCamera: CAMERA_A,
      endCamera: CAMERA_B
    });

    expect(state.uniformValues.Eye).toEqual(state.camera.eye);
    expect(state.uniformValues.Target).toEqual(state.camera.target);
    expect(state.uniformValues.Up).toEqual(state.camera.up);
    expect(state.uniformValues.FOV).toBeCloseTo(state.camera.fov);
  });
});
