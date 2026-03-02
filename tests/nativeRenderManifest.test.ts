import { describe, expect, test } from "vitest";
import { getDefaultIntegratorOptions } from "../src/core/integrators/definitions";
import { DEFAULT_RENDER_SETTINGS } from "../src/core/render/renderer";
import type { UniformDefinition } from "../src/core/parser/types";
import { buildAnimationRenderManifestV2, buildNativeRenderTask } from "../src/app/nativeRenderManifest";

const TEST_UNIFORMS: UniformDefinition[] = [
  {
    name: "Scale",
    type: "float",
    control: "slider",
    group: "Test",
    min: [0],
    max: [2],
    defaultValue: 1,
    lockType: "notlockable",
    tooltip: ""
  }
];

describe("nativeRenderManifest", () => {
  test("builds a precomposed native backend task from a timeline snapshot", () => {
    const task = buildNativeRenderTask({
      frameIndex: 0,
      frameCount: 2,
      timelineT: 0,
      seconds: 0,
      width: 1920,
      height: 1080,
      subframes: 12,
      geometrySource: `
uniform float Scale;
float DE(vec3 p) {
  return length(p) - Scale;
}
`,
      geometryLineMap: [],
      uniformDefinitions: TEST_UNIFORMS,
      snapshot: {
        integratorId: "de-pathtracer-physical",
        integratorOptions: {
          ...getDefaultIntegratorOptions("de-pathtracer-physical"),
          slicePlaneEnabled: 1,
          slicePlaneKeepFarSide: 1
        },
        renderSettings: {
          ...DEFAULT_RENDER_SETTINGS,
          toneMapping: 3,
          exposure: 0.7,
          gamma: 2.2
        },
        uniformValues: {
          Scale: 1.4
        },
        camera: {
          eye: [0, 0, -6],
          target: [0, 0, 0],
          up: [0, 1, 0],
          fov: 0.4
        },
        slicePlaneLockFrame: null
      },
      systemDefinition: {
        source: "float DE(vec3 p){ return length(p)-1.0; }",
        treePath: "Preset/Test",
        sourcePath: "session/test.frag",
        selectedSystemKey: "preset:test"
      }
    });

    const nativeBackend = task.snapshot.nativeBackend;
    expect(nativeBackend.width).toBe(1920);
    expect(nativeBackend.height).toBe(1080);
    expect(nativeBackend.maxSubframes).toBe(12);
    expect(nativeBackend.tileCount).toBe(1);
    expect(nativeBackend.tilesPerFrame).toBe(1);
    expect(nativeBackend.sceneFragmentShader).toContain("fragmentariumWebDETrace(");
    expect(nativeBackend.sceneFragmentShader).toContain("renderColor(");
    expect(nativeBackend.sceneUniforms.some((entry) => entry.name === "Scale")).toBe(true);
    expect(nativeBackend.sceneUniforms.some((entry) => entry.name === "uIntegrator_detailExp")).toBe(true);
    expect(nativeBackend.displayUniforms.some((entry) => entry.name === "uToneMapping")).toBe(true);
    expect(task.outputPath).toBe("frame_00000.png");
  });

  test("builds compact manifest with shared base payload and frame deltas", () => {
    const baseOptions = {
      ...getDefaultIntegratorOptions("de-pathtracer-physical"),
      slicePlaneEnabled: 1,
      slicePlaneKeepFarSide: 1
    };
    const baseSnapshot = {
      integratorId: "de-pathtracer-physical" as const,
      integratorOptions: baseOptions,
      renderSettings: {
        ...DEFAULT_RENDER_SETTINGS,
        toneMapping: 3,
        exposure: 0.7,
        gamma: 2.2
      },
      camera: {
        eye: [0, 0, -6] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
        up: [0, 1, 0] as [number, number, number],
        fov: 0.4
      },
      slicePlaneLockFrame: null
    };
    const task0 = buildNativeRenderTask({
      frameIndex: 0,
      frameCount: 2,
      timelineT: 0,
      seconds: 0,
      width: 1920,
      height: 1080,
      subframes: 12,
      geometrySource: `
uniform float Scale;
float DE(vec3 p) {
  return length(p) - Scale;
}
`,
      geometryLineMap: [],
      uniformDefinitions: TEST_UNIFORMS,
      snapshot: {
        ...baseSnapshot,
        uniformValues: { Scale: 1.4 }
      },
      systemDefinition: {
        source: "float DE(vec3 p){ return length(p)-1.0; }",
        treePath: "Preset/Test",
        sourcePath: "session/test.frag",
        selectedSystemKey: "preset:test"
      }
    });
    const task1 = buildNativeRenderTask({
      frameIndex: 1,
      frameCount: 2,
      timelineT: 1,
      seconds: 0.5,
      width: 1920,
      height: 1080,
      subframes: 12,
      geometrySource: `
uniform float Scale;
float DE(vec3 p) {
  return length(p) - Scale;
}
`,
      geometryLineMap: [],
      uniformDefinitions: TEST_UNIFORMS,
      snapshot: {
        ...baseSnapshot,
        uniformValues: { Scale: 1.8 }
      },
      systemDefinition: {
        source: "float DE(vec3 p){ return length(p)-1.0; }",
        treePath: "Preset/Test",
        sourcePath: "session/test.frag",
        selectedSystemKey: "preset:test"
      }
    });

    const manifest = buildAnimationRenderManifestV2({
      appVersion: "test",
      createdAtMs: 1,
      source: {
        treePath: "Preset/Test",
        sourcePath: "session/test.frag",
        selectedSystemKey: "preset:test"
      },
      width: 1920,
      height: 1080,
      frameCount: 2,
      fps: 30,
      durationSeconds: 1,
      subframes: 12,
      interpolation: "ease-in-out",
      tasks: [task0, task1]
    });

    expect(manifest.format).toBe("fragmentarium-web-animation-render-manifest-v2");
    expect(manifest.version).toBe(2);
    expect(manifest.baseTask.snapshot.nativeBackend.sceneVertexShader.length).toBeGreaterThan(0);
    expect(manifest.baseTask.snapshot.nativeBackend.sceneFragmentShader.length).toBeGreaterThan(0);
    expect(manifest.frames).toHaveLength(2);
    expect(manifest.frames[0].nativeBackendDelta.sceneUniformValues).toBeUndefined();
    expect(manifest.frames[1].nativeBackendDelta.timeSeconds).toBe(0.5);
    expect(manifest.frames[1].nativeBackendDelta.frameSeedStart).toBe(2);
    expect(manifest.frames[1].nativeBackendDelta.sceneUniformValues).toBeDefined();
    expect(
      Object.values(manifest.frames[1].nativeBackendDelta.sceneUniformValues ?? {}).some(
        (value) => value === 1.8
      )
    ).toBe(true);
  });
});
