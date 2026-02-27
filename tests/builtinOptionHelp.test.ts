import { describe, expect, test } from "vitest";
import { INTEGRATORS } from "../src/core/integrators/definitions";
import {
  BUILTIN_PANE_CONTROL_HELP_TEXT,
  INTEGRATOR_OPTION_HELP_TEXT,
  getBuiltinPaneControlHelpText,
  getIntegratorColorTripletHelpText,
  getIntegratorOptionHelpText
} from "../src/app/builtinOptionHelp";

describe("builtin option help coverage", () => {
  test("provides help text for every registered integrator option", () => {
    const optionKeys = new Set(
      INTEGRATORS.flatMap((integrator) => integrator.options.map((option) => option.key))
    );

    for (const optionKey of optionKeys) {
      const helpText = getIntegratorOptionHelpText(optionKey);
      expect(helpText.trim().length).toBeGreaterThan(0);
    }

    for (const mappedKey of Object.keys(INTEGRATOR_OPTION_HELP_TEXT)) {
      expect(optionKeys.has(mappedKey)).toBe(true);
    }
  });

  test("provides help text for every built-in render/post helper key", () => {
    for (const key of Object.keys(BUILTIN_PANE_CONTROL_HELP_TEXT) as Array<keyof typeof BUILTIN_PANE_CONTROL_HELP_TEXT>) {
      const helpText = getBuiltinPaneControlHelpText(key);
      expect(helpText.trim().length).toBeGreaterThan(0);
    }
  });

  test("provides color-triplet help text for every RGB integrator color control", () => {
    const optionKeys = new Set(
      INTEGRATORS.flatMap((integrator) => integrator.options.map((option) => option.key))
    );
    const redTripletKeys = [...optionKeys]
      .filter((key) => key.endsWith("R"))
      .filter((redKey) => optionKeys.has(`${redKey.slice(0, -1)}G`) && optionKeys.has(`${redKey.slice(0, -1)}B`));

    for (const redKey of redTripletKeys) {
      const helpText = getIntegratorColorTripletHelpText(redKey);
      expect(helpText.trim().length).toBeGreaterThan(0);
    }
  });
});
