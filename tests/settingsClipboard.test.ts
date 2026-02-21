import { describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SETTINGS } from "../src/core/render/renderer";
import {
  buildSettingsClipboardPayload,
  coerceIntegratorOptionsForId,
  parseSettingsClipboardPayload,
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
      camera: {
        eye: [1.2, -0.6, 3.4],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fov: 0.62
      }
    });

    const parsed = parseSettingsClipboardPayload(serializeSettingsClipboardPayload(payload));
    expect(parsed.format).toBe(SETTINGS_CLIPBOARD_FORMAT);
    expect(parsed.selectedPresetName).toBe("Default");
    expect(parsed.integratorId).toBe("fast-raymarch");
    expect(parsed.renderSettings.maxSubframes).toBe(45);
    expect(parsed.uniformValues.Eye).toEqual([1.2, -0.6, 3.4]);
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
});
