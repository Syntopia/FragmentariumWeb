import { describe, expect, test } from "vitest";
import type { IntegratorOptionDefinition } from "../src/core/integrators/types";
import { buildIntegratorOptionRenderItems } from "../src/app/integratorColorTriplets";
import { buildIntegratorPanelRenderItems } from "../src/app/integratorOptionLayout";

const OPTIONS: IntegratorOptionDefinition[] = [
  { key: "iblEnabled", label: "IBL Enabled", min: 0, max: 1, defaultValue: 1, step: 1 },
  { key: "areaLightOffsetX", label: "Area Off X", min: -20, max: 20, defaultValue: 0, step: 0.01 },
  { key: "areaLightOffsetY", label: "Area Off Y", min: -20, max: 20, defaultValue: 0, step: 0.01 },
  { key: "areaLightOffsetZ", label: "Area Off Z", min: -20, max: 20, defaultValue: 0, step: 0.01 },
  { key: "iblTopColorR", label: "IBL Top R", min: 0, max: 2, defaultValue: 0.2, step: 0.01 },
  { key: "iblTopColorG", label: "IBL Top G", min: 0, max: 2, defaultValue: 0.35, step: 0.01 },
  { key: "iblTopColorB", label: "IBL Top B", min: 0, max: 2, defaultValue: 0.55, step: 0.01 }
];

describe("integratorOptionLayout", () => {
  test("groups XYZ scalar rows into one axis triplet section", () => {
    const items = buildIntegratorOptionRenderItems(OPTIONS);
    const panelItems = buildIntegratorPanelRenderItems(items);

    expect(panelItems).toHaveLength(3);
    expect(panelItems[0].kind).toBe("single");
    expect(panelItems[1].kind).toBe("axisTriplet");
    expect(panelItems[2].kind).toBe("colorTriplet");

    if (panelItems[1].kind === "axisTriplet") {
      expect(panelItems[1].label).toBe("Area Offset");
      expect(panelItems[1].x.key).toBe("areaLightOffsetX");
      expect(panelItems[1].y.key).toBe("areaLightOffsetY");
      expect(panelItems[1].z.key).toBe("areaLightOffsetZ");
    }
  });

  test("does not group rows when XYZ sequence is broken", () => {
    const broken: IntegratorOptionDefinition[] = [
      { key: "offsetX", label: "Offset X", min: -1, max: 1, defaultValue: 0 },
      { key: "middle", label: "Middle", min: 0, max: 1, defaultValue: 0.4 },
      { key: "offsetY", label: "Offset Y", min: -1, max: 1, defaultValue: 0 },
      { key: "offsetZ", label: "Offset Z", min: -1, max: 1, defaultValue: 0 }
    ];
    const panelItems = buildIntegratorPanelRenderItems(buildIntegratorOptionRenderItems(broken));
    expect(panelItems.every((entry) => entry.kind === "single")).toBe(true);
  });
});
