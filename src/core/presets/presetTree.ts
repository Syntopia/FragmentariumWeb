import type { ParsedPreset } from "../parser/types";

export interface PresetTreeNode {
  name: string;
  fullPath: string;
  children: PresetTreeNode[];
  preset: ParsedPreset | null;
}

function createNode(name: string, fullPath: string): PresetTreeNode {
  return {
    name,
    fullPath,
    children: [],
    preset: null
  };
}

export function buildPresetTree(presets: ParsedPreset[]): PresetTreeNode[] {
  const roots: PresetTreeNode[] = [];

  for (const preset of presets) {
    const parts = preset.name
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part !== "");

    if (parts.length === 0) {
      continue;
    }

    let currentNodes = roots;
    let currentPath = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      currentPath = currentPath === "" ? part : `${currentPath}/${part}`;
      let node = currentNodes.find((entry) => entry.name === part);
      if (node === undefined) {
        node = createNode(part, currentPath);
        currentNodes.push(node);
      }
      if (i === parts.length - 1) {
        node.preset = preset;
      }
      currentNodes = node.children;
    }
  }

  return roots;
}
