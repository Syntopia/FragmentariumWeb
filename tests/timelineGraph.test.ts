import { describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SETTINGS } from "../src/core/render/renderer";
import type { UniformDefinition } from "../src/core/parser/types";
import {
  buildTimelineSnapshot,
  captureTimelinePatch,
  createTimelineState,
  fitTimelineKeyframes
} from "../src/app/timeline";
import { buildTimelineGraphLines } from "../src/app/timelineGraph";

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
    name: "Scale",
    type: "float",
    control: "slider",
    group: "Main",
    min: [0.1],
    max: [5],
    defaultValue: 1,
    lockType: "notlockable",
    tooltip: ""
  },
  {
    name: "Toggle",
    type: "bool",
    control: "checkbox",
    group: "Main",
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

function makeSnapshot(detail: number, scale: number, toggle: boolean) {
  return buildTimelineSnapshot({
    integratorId: "de-pathtracer-physical",
    integratorOptions: {
      detail,
      maxSteps: 200
    },
    renderSettings: {
      ...DEFAULT_RENDER_SETTINGS,
      exposure: 1 + Math.max(0, scale - 1)
    },
    uniformValues: {
      Detail: detail,
      Scale: scale,
      Toggle: toggle,
      Eye: [0, 0, -6],
      Target: [0, 0, 0],
      Up: [0, 1, 0],
      FOV: 0.4
    },
    camera: {
      eye: [0, 0, -6 + scale],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 0.4 + (scale - 1) * 0.1
    },
    slicePlaneLockFrame: null
  });
}

describe("timelineGraph", () => {
  test("builds normalized graph lines for changed timeline values", () => {
    const baseline = makeSnapshot(-2.5, 1, false);
    const end = makeSnapshot(-1.1, 1.8, true);
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0.2, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 0.8, patch: captureTimelinePatch(end, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 48,
      maxLines: 20
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.id === "uniform.Detail")).toBe(true);
    for (const line of lines) {
      expect(line.points.length).toBe(48);
      expect(line.points.every((point) => point.value >= 0 && point.value <= 1)).toBe(true);
    }
  });

  test("includes camera motion line when camera transforms between keyframes", () => {
    const baseline = makeSnapshot(-2.5, 1, false);
    const end = buildTimelineSnapshot({
      ...baseline,
      camera: {
        eye: [2, 0.5, -4.5],
        target: [0.2, 0, 0],
        up: [0, 1, 0],
        fov: baseline.camera.fov
      }
    });
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 1, patch: captureTimelinePatch(end, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 48,
      maxLines: 20
    });

    const motionLine = lines.find((line) => line.id === "camera.motion");
    expect(motionLine).toBeDefined();
    expect(motionLine?.points[0]?.value).toBeCloseTo(0);
    expect(motionLine?.points[motionLine.points.length - 1]?.value).toBeCloseTo(1);
  });

  test("includes exact timeline endpoints in graph normalization", () => {
    const baseline = makeSnapshot(0, 1, false);
    const end = makeSnapshot(2, 1, false);
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 1, patch: captureTimelinePatch(end, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 32,
      maxLines: 20
    });
    const detailLine = lines.find((line) => line.id === "uniform.Detail");
    expect(detailLine).toBeDefined();
    expect(detailLine?.points[0]?.t).toBeCloseTo(0);
    expect(detailLine?.points[detailLine.points.length - 1]?.t).toBeCloseTo(1);
    expect(detailLine?.points[0]?.value).toBeCloseTo(0);
    expect(detailLine?.points[detailLine.points.length - 1]?.value).toBeCloseTo(1);
  });

  test("normalizes against all keyframes when interior keyframes overshoot", () => {
    const start = makeSnapshot(0, 1, false);
    const mid = makeSnapshot(10, 1, false);
    const end = makeSnapshot(2, 1, false);
    const timeline = createTimelineState(start);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(start, start) },
      { id: "b", t: 0.5, patch: captureTimelinePatch(mid, start) },
      { id: "c", t: 1, patch: captureTimelinePatch(end, start) }
    ]);
    timeline.activeKeyId = "c";
    timeline.playheadT = 1;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 64,
      maxLines: 20
    });
    const detailLine = lines.find((line) => line.id === "uniform.Detail");
    expect(detailLine).toBeDefined();
    expect(detailLine?.points[0]?.value).toBeCloseTo(0);
    expect(detailLine?.points[detailLine.points.length - 1]?.value).toBeCloseTo(0.2);
  });

  test("returns no lines when values are constant", () => {
    const baseline = makeSnapshot(-2.5, 1, false);
    const timeline = createTimelineState(baseline);
    timeline.interpolation = "ease-in-out";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 32,
      maxLines: 20
    });

    expect(lines).toEqual([]);
  });

  test("returns no lines for identical multi-keyframe timeline", () => {
    const baseline = makeSnapshot(-2.5, 1, false);
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 1, patch: captureTimelinePatch(baseline, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 64,
      maxLines: 20
    });

    expect(lines).toEqual([]);
  });

  test("ignores values missing from some interpolation samples", () => {
    const baseline = buildTimelineSnapshot({
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
        Hidden: 4.2
      },
      camera: {
        eye: [0, 0, -6],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fov: 0.4
      },
      slicePlaneLockFrame: null
    });
    const end = buildTimelineSnapshot({
      ...baseline,
      uniformValues: {
        ...baseline.uniformValues,
        Detail: -1.25,
        Hidden: 6.1
      }
    });
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 1, patch: captureTimelinePatch(end, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 48,
      maxLines: 20
    });

    expect(lines.some((line) => line.id === "uniform.Hidden")).toBe(false);
    expect(lines.some((line) => line.id === "uniform.Detail")).toBe(true);
  });

  test("respects maxLines limit", () => {
    const baseline = makeSnapshot(-2.5, 1, false);
    const end = makeSnapshot(-0.5, 2, true);
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 1, patch: captureTimelinePatch(end, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 48,
      maxLines: 3
    });

    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test("does not plot unlocked aspect ratio viewport-sync changes", () => {
    const baseline = buildTimelineSnapshot({
      integratorId: "de-pathtracer-physical",
      integratorOptions: {
        detail: -2.5,
        maxSteps: 200
      },
      renderSettings: {
        ...DEFAULT_RENDER_SETTINGS,
        aspectRatioLocked: 0,
        aspectRatioX: 1032,
        aspectRatioY: 390
      },
      uniformValues: {
        Detail: -2.5,
        Scale: 1,
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
    const end = buildTimelineSnapshot({
      ...baseline,
      renderSettings: {
        ...baseline.renderSettings,
        aspectRatioY: 64
      }
    });
    const timeline = createTimelineState(baseline);
    timeline.keyframes = fitTimelineKeyframes([
      { id: "a", t: 0, patch: captureTimelinePatch(baseline, baseline) },
      { id: "b", t: 1, patch: captureTimelinePatch(end, baseline) }
    ]);
    timeline.activeKeyId = "a";
    timeline.playheadT = 0;
    timeline.interpolation = "linear";

    const lines = buildTimelineGraphLines({
      timeline,
      uniformDefinitions: UNIFORMS,
      sampleCount: 64,
      maxLines: 20
    });
    expect(lines).toEqual([]);
  });
});
