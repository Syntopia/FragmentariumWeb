import type { UniformDefinition } from "../core/parser/types";

export function normalizeUniformGroupName(group: string): string {
  const normalized = group.trim();
  return normalized.length > 0 ? normalized : "Default";
}

export function getUniformGroupNames(uniforms: UniformDefinition[]): string[] {
  const groups = new Set<string>();
  for (const uniform of uniforms) {
    groups.add(normalizeUniformGroupName(uniform.group));
  }
  return [...groups].sort((a, b) => a.localeCompare(b));
}
