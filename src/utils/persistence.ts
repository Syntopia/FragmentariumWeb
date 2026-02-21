import type { CameraState } from "../core/geometry/camera";
import type { IntegratorOptionValues } from "../core/integrators/types";
import type { UniformValue } from "../core/parser/types";
import type { RenderSettings } from "../core/render/renderer";

export interface PersistedState {
  leftPanePx: number;
  rightPanePx: number;
  selectedSystemKey: string;
  activeIntegratorId: string;
  editorSourceBySystem: Record<string, string>;
  localSystemsByPath: Record<string, string>;
  integratorOptionsById: Record<string, IntegratorOptionValues>;
  uniformValuesBySystem: Record<string, Record<string, UniformValue>>;
  cameraBySystem: Record<string, CameraState>;
  renderSettings: RenderSettings;
}

const STORAGE_KEY = "fragmentarium-web-state-v1";

export function loadPersistedState(): PersistedState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  const parsed = JSON.parse(raw) as PersistedState;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid persisted state payload.");
  }

  return parsed;
}

export function savePersistedState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
