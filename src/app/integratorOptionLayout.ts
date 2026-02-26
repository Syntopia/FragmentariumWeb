import type { IntegratorOptionDefinition } from "../core/integrators/types";
import type {
  IntegratorColorTripletRenderItem,
  IntegratorOptionRenderItem,
  IntegratorSingleOptionRenderItem
} from "./integratorColorTriplets";

export interface IntegratorAxisTripletRenderItem {
  kind: "axisTriplet";
  label: string;
  x: IntegratorOptionDefinition;
  y: IntegratorOptionDefinition;
  z: IntegratorOptionDefinition;
}

export type IntegratorPanelRenderItem =
  | IntegratorSingleOptionRenderItem
  | IntegratorColorTripletRenderItem
  | IntegratorAxisTripletRenderItem;

interface AxisSuffixParts {
  base: string;
  axis: "X" | "Y" | "Z";
}

function parseAxisSuffixFromKey(key: string): AxisSuffixParts | null {
  const match = /^(.*)(X|Y|Z)$/.exec(key);
  if (match === null || match[1].length === 0) {
    return null;
  }
  const axis = match[2];
  if (axis !== "X" && axis !== "Y" && axis !== "Z") {
    return null;
  }
  return {
    base: match[1],
    axis
  };
}

function parseAxisSuffixFromLabel(label: string): AxisSuffixParts | null {
  const match = /^(.*)\s(X|Y|Z)$/.exec(label.trim());
  if (match === null || match[1].length === 0) {
    return null;
  }
  const axis = match[2];
  if (axis !== "X" && axis !== "Y" && axis !== "Z") {
    return null;
  }
  return {
    base: match[1],
    axis
  };
}

function isSingleItem(item: IntegratorOptionRenderItem | undefined): item is IntegratorSingleOptionRenderItem {
  return item !== undefined && item.kind === "single";
}

function canFormAxisTriplet(
  xItem: IntegratorOptionRenderItem | undefined,
  yItem: IntegratorOptionRenderItem | undefined,
  zItem: IntegratorOptionRenderItem | undefined
): xItem is IntegratorSingleOptionRenderItem {
  if (!isSingleItem(xItem) || !isSingleItem(yItem) || !isSingleItem(zItem)) {
    return false;
  }
  const xKey = parseAxisSuffixFromKey(xItem.option.key);
  const yKey = parseAxisSuffixFromKey(yItem.option.key);
  const zKey = parseAxisSuffixFromKey(zItem.option.key);
  const xLabel = parseAxisSuffixFromLabel(xItem.option.label);
  const yLabel = parseAxisSuffixFromLabel(yItem.option.label);
  const zLabel = parseAxisSuffixFromLabel(zItem.option.label);
  if (xKey === null || yKey === null || zKey === null || xLabel === null || yLabel === null || zLabel === null) {
    return false;
  }
  if (xKey.axis !== "X" || yKey.axis !== "Y" || zKey.axis !== "Z") {
    return false;
  }
  if (xLabel.axis !== "X" || yLabel.axis !== "Y" || zLabel.axis !== "Z") {
    return false;
  }
  if (xKey.base !== yKey.base || xKey.base !== zKey.base) {
    return false;
  }
  if (xLabel.base !== yLabel.base || xLabel.base !== zLabel.base) {
    return false;
  }
  return true;
}

function normalizeAxisTripletLabel(baseLabel: string): string {
  if (/\bOff$/u.test(baseLabel)) {
    return baseLabel.replace(/\bOff$/u, "Offset");
  }
  return baseLabel;
}

export function buildIntegratorPanelRenderItems(
  items: IntegratorOptionRenderItem[]
): IntegratorPanelRenderItem[] {
  const panelItems: IntegratorPanelRenderItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const first = items[index];
    const second = items[index + 1];
    const third = items[index + 2];
    if (canFormAxisTriplet(first, second, third) && isSingleItem(second) && isSingleItem(third)) {
      const baseLabel = parseAxisSuffixFromLabel(first.option.label)?.base ?? first.option.label;
      panelItems.push({
        kind: "axisTriplet",
        label: normalizeAxisTripletLabel(baseLabel),
        x: first.option,
        y: second.option,
        z: third.option
      });
      index += 2;
      continue;
    }
    panelItems.push(first);
  }
  return panelItems;
}
