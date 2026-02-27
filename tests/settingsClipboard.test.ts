import { describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SETTINGS } from "../src/core/render/renderer";
import {
  buildSettingsClipboardPayload,
  coerceIntegratorOptionsForId,
  parseSettingsClipboardPayload,
  serializeSettingsClipboardPayloadForSessionComparison,
  serializeSettingsClipboardPayload,
  SETTINGS_CLIPBOARD_FORMAT
} from "../src/app/settingsClipboard";

describe("settingsClipboard", () => {
  test("round-trips payload through JSON serialization", () => {
    const payload = buildSettingsClipboardPayload({
      selectedPresetName: "Default",
      integratorId: "fast-raymarch",
      integratorOptions: {
        detailExp: -2.1,
        maxRaySteps: 120,
        fudgeFactor: 1.05,
        backgroundStrength: 0.3
      },
      renderSettings: {
        ...DEFAULT_RENDER_SETTINGS,
        maxSubframes: 45
      },
      uniformValues: {
        Scale: 1.1,
        Eye: [1.2, -0.6, 3.4],
        EnableFog: true
      },
      systemDefinition: {
        source: "float DE(vec3 p){ return length(p)-1.0; }\n",
        treePath: "Built-in/Fractals/Mandelbulb",
        sourcePath: "mandelbulb.frag",
        selectedSystemKey: "preset:mandelbulb"
      },
      camera: {
        eye: [1.2, -0.6, 3.4],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fov: 0.62
      },
      slicePlaneLockFrame: {
        origin: [0.5, 1.25, -2],
        normal: [0, 0, 1]
      }
    });

    const parsed = parseSettingsClipboardPayload(serializeSettingsClipboardPayload(payload));
    expect(parsed.format).toBe(SETTINGS_CLIPBOARD_FORMAT);
    expect(parsed.selectedPresetName).toBe("Default");
    expect(parsed.integratorId).toBe("fast-raymarch");
    expect(parsed.renderSettings.maxSubframes).toBe(45);
    expect(parsed.uniformValues.Eye).toEqual([1.2, -0.6, 3.4]);
    expect(parsed.systemDefinition?.sourcePath).toBe("mandelbulb.frag");
    expect(parsed.slicePlaneLockFrame).toEqual({
      origin: [0.5, 1.25, -2],
      normal: [0, 0, 1]
    });
  });

  test("rejects payloads with an invalid format marker", () => {
    const invalid = JSON.stringify({
      format: "wrong",
      selectedPresetName: null,
      integratorId: "fast-raymarch",
      integratorOptions: {},
      renderSettings: DEFAULT_RENDER_SETTINGS,
      uniformValues: {},
      camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 }
    });

    expect(() => parseSettingsClipboardPayload(invalid)).toThrowError(
      "Clipboard payload format must be 'fragmentarium-web-settings-v1'."
    );
  });

  test("clamps pasted integrator values to the selected integrator bounds", () => {
    const coerced = coerceIntegratorOptionsForId("fast-raymarch", {
      detailExp: -100,
      maxRaySteps: 9999,
      fudgeFactor: 0.1,
      backgroundStrength: 2
    });

    expect(coerced.detailExp).toBe(-7);
    expect(coerced.maxRaySteps).toBe(1024);
    expect(coerced.fudgeFactor).toBe(0.25);
    expect(coerced.backgroundStrength).toBe(1);
  });

  test("accepts legacy payloads without embedded system definition", () => {
    const payload = JSON.stringify({
      format: SETTINGS_CLIPBOARD_FORMAT,
      selectedPresetName: null,
      integratorId: "fast-raymarch",
      integratorOptions: {},
      renderSettings: DEFAULT_RENDER_SETTINGS,
      uniformValues: {},
      camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 }
    });

    const parsed = parseSettingsClipboardPayload(payload);
    expect(parsed.systemDefinition).toBeUndefined();
  });

  test("session comparison ignores system metadata hints and selected key", () => {
    const base = buildSettingsClipboardPayload({
      selectedPresetName: "Default",
      integratorId: "fast-raymarch",
      integratorOptions: {},
      renderSettings: DEFAULT_RENDER_SETTINGS,
      uniformValues: { Eye: [1, 2, 3] },
      camera: { eye: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0], fov: 0.5 },
      systemDefinition: {
        source: "float DE(vec3 p){return length(p)-1.0;}\n",
        treePath: "Built-in/Fractals/Mandelbulb",
        sourcePath: "mandelbulb.frag",
        selectedSystemKey: "preset:mandelbulb"
      }
    });

    const sameContentDifferentMetadata = buildSettingsClipboardPayload({
      ...base,
      systemDefinition: {
        source: base.systemDefinition!.source,
        treePath: "Sessions/foo",
        sourcePath: "session/foo.frag",
        selectedSystemKey: "local:foo"
      }
    });

    expect(serializeSettingsClipboardPayloadForSessionComparison(sameContentDifferentMetadata)).toBe(
      serializeSettingsClipboardPayloadForSessionComparison(base)
    );
  });

  test("session comparison includes slice plane lock frame", () => {
    const base = buildSettingsClipboardPayload({
      selectedPresetName: null,
      integratorId: "de-raytracer",
      integratorOptions: {},
      renderSettings: DEFAULT_RENDER_SETTINGS,
      uniformValues: {},
      camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 },
      slicePlaneLockFrame: {
        origin: [1, 2, 3],
        normal: [0, 1, 0]
      }
    });
    const changed = buildSettingsClipboardPayload({
      ...base,
      slicePlaneLockFrame: {
        origin: [1, 2, 4],
        normal: [0, 1, 0]
      }
    });

    expect(serializeSettingsClipboardPayloadForSessionComparison(changed)).not.toBe(
      serializeSettingsClipboardPayloadForSessionComparison(base)
    );
  });

  test("round-trips timeline state and includes it in session comparison", () => {
    const base = buildSettingsClipboardPayload({
      selectedPresetName: null,
      integratorId: "de-pathtracer-physical",
      integratorOptions: {},
      renderSettings: DEFAULT_RENDER_SETTINGS,
      uniformValues: {},
      camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 },
      timeline: {
        version: 1,
        baseline: {
          integratorId: "de-pathtracer-physical",
          integratorOptions: { detail: -2.5 },
          renderSettings: { ...DEFAULT_RENDER_SETTINGS },
          uniformValues: { Detail: -2.5 },
          camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 },
          slicePlaneLockFrame: null
        },
        keyframes: [
          { id: "a", t: 0, patch: {} },
          { id: "b", t: 1, patch: { uniformValues: { Detail: -1.0 } } }
        ],
        activeKeyId: "a",
        playheadT: 0,
        interpolation: "monotone-cubic",
        playbackDurationSeconds: 1.5
      }
    });
    const changed = buildSettingsClipboardPayload({
      ...base,
      timeline: base.timeline === null || base.timeline === undefined
        ? base.timeline
        : {
            ...base.timeline,
            keyframes: [
              { id: "a", t: 0, patch: {} },
              { id: "b", t: 1, patch: { uniformValues: { Detail: -0.8 } } }
            ]
          }
    });

    const parsed = parseSettingsClipboardPayload(serializeSettingsClipboardPayload(base));
    expect(parsed.timeline?.keyframes).toHaveLength(2);
    expect(parsed.timeline?.interpolation).toBe("monotone-cubic");
    expect(parsed.timeline?.keyframes[1].patch.uniformValues?.Detail).toBeCloseTo(-1.0);
    expect(serializeSettingsClipboardPayloadForSessionComparison(base)).not.toBe(
      serializeSettingsClipboardPayloadForSessionComparison(changed)
    );
  });

  test("defaults legacy timeline playback duration when missing", () => {
    const payload = JSON.stringify({
      format: SETTINGS_CLIPBOARD_FORMAT,
      selectedPresetName: null,
      integratorId: "de-pathtracer-physical",
      integratorOptions: {},
      renderSettings: DEFAULT_RENDER_SETTINGS,
      uniformValues: {},
      camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 },
      timeline: {
        version: 1,
        baseline: {
          integratorId: "de-pathtracer-physical",
          integratorOptions: {},
          renderSettings: DEFAULT_RENDER_SETTINGS,
          uniformValues: {},
          camera: { eye: [0, 0, -6], target: [0, 0, 0], up: [0, 1, 0], fov: 0.4 },
          slicePlaneLockFrame: null
        },
        keyframes: [{ id: "k0", t: 0.5, patch: {} }],
        activeKeyId: "k0",
        playheadT: 0.5,
        interpolation: "linear"
      }
    });

    const parsed = parseSettingsClipboardPayload(payload);
    expect(parsed.timeline?.playbackDurationSeconds).toBeCloseTo(3);
  });
});
