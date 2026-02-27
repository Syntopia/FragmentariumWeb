import { describe, expect, test } from "vitest";
import type { UniformDefinition } from "../src/core/parser/types";
import { DEFAULT_RENDER_SETTINGS } from "../src/core/render/renderer";
import {
  buildTimelineSnapshot,
  captureTimelinePatch,
  createTimelineState,
  evenlyDistributeTimelineKeyframes,
  fitTimelineKeyframes,
  interpolateTimelineSnapshotAt,
  resolveTimelineSnapshotFromPatch
} from "../src/app/timeline";

const UNIFORMS: UniformDefinition[] = [
  {
    name: "Detail",
    type: "float",
    control: "slider",
    group: "Tracing",
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
    group: "Tracing",
    min: [0],
    max: [1],
    defaultValue: false,
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Eye",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-10, -10, -10],
    max: [10, 10, 10],
    defaultValue: [0, 0, -6],
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Target",
    type: "vec3",
    control: "slider",
    group: "Camera",
    min: [-10, -10, -10],
    max: [10, 10, 10],
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
    max: [2],
    defaultValue: 0.4,
    lockType: "notlockable",
    tooltip: ""
  }
];

function makeSnapshot(overrides?: Partial<ReturnType<typeof buildTimelineSnapshot>>) {
  const base = buildTimelineSnapshot({
    integratorId: "de-pathtracer-physical",
    integratorOptions: {
      detail: -2.5,
      maxSteps: 200
    },
    renderSettings: {
      ...DEFAULT_RENDER_SETTINGS
    },
    uniformValues: {
      Detail: -2.5,
      Toggle: false,
      Eye: [0, 0, -6],
      Target: [0, 0, 0],
      Up: [0, 1, 0],
      FOV: 0.4
    },
    camera: {
      eye: [0, 0, -6],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 0.4
    },
    slicePlaneLockFrame: null
  });
  return {
    ...base,
    ...overrides
  };
}

describe("timeline", () => {
  test("creates an initial timeline with a centered active keyframe", () => {
    const state = createTimelineState(makeSnapshot());
    expect(state.keyframes).toHaveLength(1);
    expect(state.keyframes[0].t).toBeCloseTo(0.5);
    expect(state.activeKeyId).toBe(state.keyframes[0].id);
    expect(state.playheadT).toBeCloseTo(0.5);
  });

  test("captures patch changes and reconstructs full state from baseline", () => {
    const baseline = makeSnapshot();
    const modified = makeSnapshot({
      uniformValues: {
        ...baseline.uniformValues,
        Detail: -1.25
      },
      camera: {
        eye: [1, 0.2, -4],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fov: 0.7
      }
    });
    const patch = captureTimelinePatch(modified, baseline);
    const rebuilt = resolveTimelineSnapshotFromPatch(baseline, patch);
    expect(rebuilt.uniformValues.Detail).toBeCloseTo(-1.25);
    expect(rebuilt.camera.fov).toBeCloseTo(0.7);
    expect(rebuilt.camera.eye).toEqual([1, 0.2, -4]);
  });

  test("fits keyframes to normalized [0, 1] range and interpolates timeline state", () => {
    const baseline = makeSnapshot();
    const start = makeSnapshot();
    const end = makeSnapshot({
      uniformValues: {
        ...baseline.uniformValues,
        Detail: -1.0
      },
      camera: {
        eye: [2, 1, -4],
        target: [0.5, 0.2, 0],
        up: [0, 1, 0],
        fov: 0.8
      }
    });
    const timeline = createTimelineState(baseline);
    const startPatch = captureTimelinePatch(start, baseline);
    const endPatch = captureTimelinePatch(end, baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0.2, patch: startPatch },
      { id: "b", t: 0.8, patch: endPatch }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    expect(timeline.keyframes[0].t).toBeCloseTo(0);
    expect(timeline.keyframes[1].t).toBeCloseTo(1);

    const mid = interpolateTimelineSnapshotAt(timeline, 0.5, UNIFORMS);
    expect(Number(mid.uniformValues.Detail)).toBeCloseTo(-1.75, 3);
    expect(mid.camera.fov).toBeCloseTo(0.6, 3);
    expect(mid.uniformValues.Eye).toEqual(mid.camera.eye);
  });

  test("fitTimelineKeyframes preserves outside-range insertion for both ends", () => {
    const patch = captureTimelinePatch(makeSnapshot(), makeSnapshot());

    const rightExtended = fitTimelineKeyframes([
      { id: "left", t: 0, patch },
      { id: "right", t: 1, patch },
      { id: "newRight", t: 1.2, patch }
    ]);
    const rightById = new Map(rightExtended.map((entry) => [entry.id, entry.t]));
    expect(rightById.get("newRight")).toBeCloseTo(1);
    expect((rightById.get("right") ?? 0) < 1).toBe(true);
    expect(rightById.get("left")).toBeCloseTo(0);

    const leftExtended = fitTimelineKeyframes([
      { id: "newLeft", t: -0.2, patch },
      { id: "left", t: 0, patch },
      { id: "right", t: 1, patch }
    ]);
    const leftById = new Map(leftExtended.map((entry) => [entry.id, entry.t]));
    expect(leftById.get("newLeft")).toBeCloseTo(0);
    expect((leftById.get("left") ?? 1) > 0).toBe(true);
    expect(leftById.get("right")).toBeCloseTo(1);
  });

  test("evenlyDistributeTimelineKeyframes spaces keys uniformly", () => {
    const patch = captureTimelinePatch(makeSnapshot(), makeSnapshot());
    const evened = evenlyDistributeTimelineKeyframes([
      { id: "a", t: 0.1, patch },
      { id: "b", t: 0.3, patch },
      { id: "c", t: 0.9, patch },
      { id: "d", t: 1.0, patch }
    ]);
    const byId = new Map(evened.map((entry) => [entry.id, entry.t]));
    expect(byId.get("a")).toBeCloseTo(0);
    expect(byId.get("b")).toBeCloseTo(1 / 3);
    expect(byId.get("c")).toBeCloseTo(2 / 3);
    expect(byId.get("d")).toBeCloseTo(1);
  });

  test("ignores unlocked aspect ratio viewport sync values in timeline patches", () => {
    const baseline = makeSnapshot({
      renderSettings: {
        ...DEFAULT_RENDER_SETTINGS,
        aspectRatioLocked: 0,
        aspectRatioX: 1032,
        aspectRatioY: 390
      }
    });
    const modified = makeSnapshot({
      renderSettings: {
        ...DEFAULT_RENDER_SETTINGS,
        aspectRatioLocked: 0,
        aspectRatioX: 1032,
        aspectRatioY: 64
      }
    });
    const patch = captureTimelinePatch(modified, baseline);
    expect(patch.renderSettings).toBeUndefined();

    const modifiedLocked = makeSnapshot({
      renderSettings: {
        ...DEFAULT_RENDER_SETTINGS,
        aspectRatioLocked: 1,
        aspectRatioX: 16,
        aspectRatioY: 9
      }
    });
    const lockedPatch = captureTimelinePatch(modifiedLocked, baseline);
    expect(lockedPatch.renderSettings?.aspectRatioLocked).toBe(1);
    expect(lockedPatch.renderSettings?.aspectRatioX).toBeCloseTo(16);
    expect(lockedPatch.renderSettings?.aspectRatioY).toBeCloseTo(9);
  });
});
