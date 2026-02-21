import { useCallback, useEffect, useMemo, useState } from "react";
import { DefinitionEditor } from "../components/DefinitionEditor";
import { ConfirmDeleteLocalSystemDialog } from "../components/ConfirmDeleteLocalSystemDialog";
import { SaveLocalSystemDialog } from "../components/SaveLocalSystemDialog";
import { SplitLayout } from "../components/SplitLayout";
import {
  SystemsTreeView,
  type SystemsTreeFolderNode,
  type SystemsTreeNode
} from "../components/SystemsTreeView";
import { UniformPanel } from "../components/UniformPanel";
import { VerticalSplitLayout } from "../components/VerticalSplitLayout";
import { VerticalTabList, type VerticalTabItem } from "../components/VerticalTabList";
import { ViewportPane } from "../components/ViewportPane";
import { type CameraState } from "../core/geometry/camera";
import { INTEGRATORS, getDefaultIntegratorOptions, getIntegratorById } from "../core/integrators/definitions";
import type { IntegratorOptionDefinition, IntegratorOptionValues } from "../core/integrators/types";
import { parseFragmentSource } from "../core/parser/fragmentParser";
import { applyPresetValues, getDefaultUniformValues, sanitizeUniformValue } from "../core/parser/uniformState";
import type { ParseResult, ParsedPreset, UniformDefinition, UniformValue } from "../core/parser/types";
import {
  DEFAULT_RENDER_SETTINGS,
  type RenderSettings,
  type RendererStatus
} from "../core/render/renderer";
import { FRACTAL_SYSTEMS, SYSTEM_INCLUDE_MAP, type FractalSystemDefinition } from "../systems/registry";
import { loadPersistedState, savePersistedState } from "../utils/persistence";
import { selectPresetForActivation } from "./presetSelection";
import {
  buildSettingsClipboardPayload,
  coerceIntegratorOptionsForId,
  parseSettingsClipboardPayload,
  serializeSettingsClipboardPayload
} from "./settingsClipboard";
import { getUniformGroupNames, normalizeUniformGroupName } from "./uniformGroups";

const MIN_PANE_WIDTH = 240;
const MIN_LEFT_SECTION_HEIGHT = 140;
const LEGACY_INTEGRATOR_ID_MAP: Record<string, string> = {
  "de-pathtracer": "de-pathtracer-physical"
};
const STATIC_RIGHT_PANE_TABS: VerticalTabItem[] = [
  { id: "integrator", label: "Raytracer" },
  { id: "render", label: "Render" },
  { id: "post", label: "Post" }
];
const UNIFORM_GROUP_TAB_PREFIX = "uniform-group:";
type RightPaneTabId = string;

function makeUniformGroupTabId(group: string): string {
  return `${UNIFORM_GROUP_TAB_PREFIX}${group}`;
}

function parseUniformGroupFromTabId(tabId: string): string | null {
  if (!tabId.startsWith(UNIFORM_GROUP_TAB_PREFIX)) {
    return null;
  }
  const value = tabId.slice(UNIFORM_GROUP_TAB_PREFIX.length);
  return value.length > 0 ? value : null;
}

const defaultCamera: CameraState = {
  eye: [0, 0, -6],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 0.4
};

interface InitialState {
  leftPanePx: number;
  rightPanePx: number;
  leftSystemsPaneHeightPx: number;
  selectedSystemKey: string;
  activeIntegratorId: string;
  localSystemsByPath: Record<string, string>;
  editorSourceBySystem: Record<string, string>;
  integratorOptionsById: Record<string, IntegratorOptionValues>;
  uniformValuesBySystem: Record<string, Record<string, UniformValue>>;
  cameraBySystem: Record<string, CameraState>;
  renderSettings: RenderSettings;
  persistenceError: string | null;
}

interface LegacyPersistedState {
  leftPanePx?: number;
  rightPanePx?: number;
  leftSystemsPaneHeightPx?: number;
  selectedSystemId?: string;
  selectedSystemKey?: string;
  activeIntegratorId?: string;
  localSystemsByPath?: Record<string, string>;
  editorSourceBySystem?: Record<string, string>;
  integratorOptionsById?: Record<string, IntegratorOptionValues>;
  uniformValuesBySystem?: Record<string, Record<string, UniformValue>>;
  cameraBySystem?: Record<string, CameraState>;
  renderSettings?: Partial<RenderSettings>;
}

interface SaveLocalDialogState {
  pathValue: string;
  errorMessage: string | null;
}

const PRESET_KEY_PREFIX = "preset:";
const LOCAL_KEY_PREFIX = "local:";

function findPresetSystemById(systemId: string): FractalSystemDefinition | null {
  return FRACTAL_SYSTEMS.find((entry) => entry.id === systemId) ?? null;
}

function makePresetEntryKey(systemId: string): string {
  return `${PRESET_KEY_PREFIX}${systemId}`;
}

function makeLocalEntryKey(path: string): string {
  return `${LOCAL_KEY_PREFIX}${path}`;
}

function parsePresetIdFromKey(entryKey: string): string | null {
  if (!entryKey.startsWith(PRESET_KEY_PREFIX)) {
    return null;
  }
  const value = entryKey.slice(PRESET_KEY_PREFIX.length);
  return value.length > 0 ? value : null;
}

function parseLocalPathFromKey(entryKey: string): string | null {
  if (!entryKey.startsWith(LOCAL_KEY_PREFIX)) {
    return null;
  }
  const value = entryKey.slice(LOCAL_KEY_PREFIX.length);
  return value.length > 0 ? value : null;
}

function filterToLocalEditorSources(
  source: Record<string, string>,
  localSystemsByPath: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [entryKey, draft] of Object.entries(source)) {
    const localPath = parseLocalPathFromKey(entryKey);
    if (localPath === null) {
      continue;
    }
    if (localSystemsByPath[localPath] === undefined) {
      continue;
    }
    next[entryKey] = draft;
  }
  return next;
}

function normalizeLocalPath(input: string): string | null {
  const normalized = input
    .trim()
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.split("/").some((segment) => segment.trim().length === 0)) {
    return null;
  }
  return normalized;
}

function buildDefaultEditorSourceBySystem(): Record<string, string> {
  return FRACTAL_SYSTEMS.reduce<Record<string, string>>((acc, system) => {
    acc[makePresetEntryKey(system.id)] = system.source;
    return acc;
  }, {});
}

function migrateEntryKey(raw: string | undefined, localSystemsByPath: Record<string, string>): string | null {
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  if (raw.startsWith(PRESET_KEY_PREFIX) || raw.startsWith(LOCAL_KEY_PREFIX)) {
    return raw;
  }
  if (findPresetSystemById(raw) !== null) {
    return makePresetEntryKey(raw);
  }
  if (localSystemsByPath[raw] !== undefined) {
    return makeLocalEntryKey(raw);
  }
  return null;
}

function migrateRecordKeys<T>(
  source: Record<string, T> | undefined,
  localSystemsByPath: Record<string, string>
): Record<string, T> {
  if (source === undefined) {
    return {};
  }

  const next: Record<string, T> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = migrateEntryKey(rawKey, localSystemsByPath);
    if (key === null) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function isKnownSelectionKey(entryKey: string, localSystemsByPath: Record<string, string>): boolean {
  const presetId = parsePresetIdFromKey(entryKey);
  if (presetId !== null) {
    return findPresetSystemById(presetId) !== null;
  }
  const localPath = parseLocalPathFromKey(entryKey);
  if (localPath !== null) {
    return localSystemsByPath[localPath] !== undefined;
  }
  return false;
}

function buildInitialState(): InitialState {
  const fallbackSelectionKey = makePresetEntryKey(FRACTAL_SYSTEMS[0].id);
  const defaults: InitialState = {
    leftPanePx: 380,
    rightPanePx: 380,
    leftSystemsPaneHeightPx: 220,
    selectedSystemKey: fallbackSelectionKey,
    activeIntegratorId: INTEGRATORS[0].id,
    localSystemsByPath: {},
    editorSourceBySystem: buildDefaultEditorSourceBySystem(),
    integratorOptionsById: INTEGRATORS.reduce<Record<string, IntegratorOptionValues>>((acc, integrator) => {
      acc[integrator.id] = getDefaultIntegratorOptions(integrator.id);
      return acc;
    }, {}),
    uniformValuesBySystem: {},
    cameraBySystem: {},
    renderSettings: { ...DEFAULT_RENDER_SETTINGS },
    persistenceError: null
  };

  try {
    const persisted = loadPersistedState();
    if (persisted === null) {
      return defaults;
    }

    const legacy = persisted as unknown as LegacyPersistedState;
    const localSystemsByPath = { ...(legacy.localSystemsByPath ?? {}) };
    const migratedEditorSourceBySystem = {
      ...defaults.editorSourceBySystem,
      ...filterToLocalEditorSources(
        migrateRecordKeys(legacy.editorSourceBySystem, localSystemsByPath),
        localSystemsByPath
      )
    };
    for (const [path, source] of Object.entries(localSystemsByPath)) {
      const key = makeLocalEntryKey(path);
      if (migratedEditorSourceBySystem[key] === undefined) {
        migratedEditorSourceBySystem[key] = source;
      }
    }

    const migratedSelectedKey =
      migrateEntryKey(legacy.selectedSystemKey ?? legacy.selectedSystemId, localSystemsByPath) ??
      defaults.selectedSystemKey;

    return {
      ...defaults,
      leftPanePx: legacy.leftPanePx ?? defaults.leftPanePx,
      rightPanePx: legacy.rightPanePx ?? defaults.rightPanePx,
      leftSystemsPaneHeightPx: legacy.leftSystemsPaneHeightPx ?? defaults.leftSystemsPaneHeightPx,
      selectedSystemKey: isKnownSelectionKey(migratedSelectedKey, localSystemsByPath)
        ? migratedSelectedKey
        : defaults.selectedSystemKey,
      activeIntegratorId: normalizeIntegratorId(legacy.activeIntegratorId ?? defaults.activeIntegratorId),
      localSystemsByPath,
      editorSourceBySystem: migratedEditorSourceBySystem,
      integratorOptionsById: normalizeIntegratorOptionsById(legacy.integratorOptionsById),
      uniformValuesBySystem: migrateRecordKeys(legacy.uniformValuesBySystem, localSystemsByPath),
      cameraBySystem: migrateRecordKeys(legacy.cameraBySystem, localSystemsByPath),
      renderSettings: coerceRenderSettings(legacy.renderSettings)
    };
  } catch (error) {
    return {
      ...defaults,
      persistenceError: error instanceof Error ? error.message : String(error)
    };
  }
}

function deriveCameraFromUniformValues(
  uniformDefinitions: UniformDefinition[],
  values: Record<string, UniformValue>,
  fallback: CameraState
): CameraState {
  const hasUniform = (name: string): boolean => uniformDefinitions.some((entry) => entry.name === name);
  const eye = hasUniform("Eye") ? asVec3(values.Eye) : null;
  const target = hasUniform("Target") ? asVec3(values.Target) : null;
  const up = hasUniform("Up") ? asVec3(values.Up) : null;
  const fov = hasUniform("FOV") ? asScalar(values.FOV) : null;

  return {
    eye: eye ?? fallback.eye,
    target: target ?? fallback.target,
    up: up ?? fallback.up,
    fov: fov ?? fallback.fov
  };
}

function coerceUniformValues(
  definitions: UniformDefinition[],
  candidate: Record<string, UniformValue> | undefined
): Record<string, UniformValue> {
  const defaults = getDefaultUniformValues(definitions);
  if (candidate === undefined) {
    return defaults;
  }

  const next = { ...defaults };
  for (const definition of definitions) {
    const raw = candidate[definition.name];
    if (raw === undefined) {
      continue;
    }
    next[definition.name] = sanitizeUniformValue(definition, raw);
  }
  return next;
}

function asVec3(value: UniformValue | undefined): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function asScalar(value: UniformValue | undefined): number | null {
  if (value === undefined || Array.isArray(value) || typeof value === "boolean") {
    return null;
  }
  return Number(value);
}

function findPresetByPath(parseResult: ParseResult | null, path: string): ParsedPreset | null {
  if (parseResult === null) {
    return null;
  }
  return parseResult.presets.find((preset) => preset.name === path) ?? null;
}

function optionStep(option: IntegratorOptionDefinition): number {
  if (option.step !== undefined) {
    return option.step;
  }
  const span = option.max - option.min;
  if (span > 100) {
    return 0.1;
  }
  if (span > 10) {
    return 0.01;
  }
  return 0.001;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeIntegratorId(rawId: string | undefined): string {
  if (rawId === undefined) {
    return INTEGRATORS[0].id;
  }

  const mapped = LEGACY_INTEGRATOR_ID_MAP[rawId] ?? rawId;
  return INTEGRATORS.some((integrator) => integrator.id === mapped) ? mapped : INTEGRATORS[0].id;
}

function normalizeIntegratorOptionsById(
  persisted: Record<string, IntegratorOptionValues> | undefined
): Record<string, IntegratorOptionValues> {
  const next = INTEGRATORS.reduce<Record<string, IntegratorOptionValues>>((acc, integrator) => {
    acc[integrator.id] = getDefaultIntegratorOptions(integrator.id);
    return acc;
  }, {});

  if (persisted === undefined) {
    return next;
  }

  for (const [rawId, options] of Object.entries(persisted)) {
    const normalizedId = LEGACY_INTEGRATOR_ID_MAP[rawId] ?? rawId;
    if (!INTEGRATORS.some((integrator) => integrator.id === normalizedId)) {
      continue;
    }
    next[normalizedId] = {
      ...next[normalizedId],
      ...options
    };
  }

  return next;
}

function coerceRenderSettings(candidate: Partial<RenderSettings> | undefined): RenderSettings {
  const source = candidate ?? {};
  return {
    interactionResolutionScale: clamp(
      source.interactionResolutionScale ?? DEFAULT_RENDER_SETTINGS.interactionResolutionScale,
      0.25,
      1
    ),
    maxSubframes: Math.max(0, Math.round(source.maxSubframes ?? DEFAULT_RENDER_SETTINGS.maxSubframes)),
    tileCount: Math.max(1, Math.round(source.tileCount ?? DEFAULT_RENDER_SETTINGS.tileCount)),
    tilesPerFrame: Math.max(1, Math.round(source.tilesPerFrame ?? DEFAULT_RENDER_SETTINGS.tilesPerFrame)),
    toneMapping: Math.round(clamp(source.toneMapping ?? DEFAULT_RENDER_SETTINGS.toneMapping, 1, 4)),
    exposure: clamp(source.exposure ?? DEFAULT_RENDER_SETTINGS.exposure, 0, 8),
    gamma: clamp(source.gamma ?? DEFAULT_RENDER_SETTINGS.gamma, 0.2, 5),
    brightness: clamp(source.brightness ?? DEFAULT_RENDER_SETTINGS.brightness, 0, 5),
    contrast: clamp(source.contrast ?? DEFAULT_RENDER_SETTINGS.contrast, 0, 5),
    saturation: clamp(source.saturation ?? DEFAULT_RENDER_SETTINGS.saturation, 0, 5)
  };
}

function getSourceName(entryKey: string): string {
  const presetId = parsePresetIdFromKey(entryKey);
  if (presetId !== null) {
    return `${presetId}.frag`;
  }
  const localPath = parseLocalPathFromKey(entryKey);
  if (localPath !== null) {
    const safe = localPath.replaceAll(/[^A-Za-z0-9/_-]+/g, "_");
    return `local/${safe}.frag`;
  }
  return "system.frag";
}

function getBaselineSourceForEntry(
  entryKey: string,
  localSystemsByPath: Record<string, string>
): string {
  const presetId = parsePresetIdFromKey(entryKey);
  if (presetId !== null) {
    return findPresetSystemById(presetId)?.source ?? "";
  }
  const localPath = parseLocalPathFromKey(entryKey);
  if (localPath !== null) {
    return localSystemsByPath[localPath] ?? "";
  }
  return "";
}

function buildSystemsTreeNodes(localSystemsByPath: Record<string, string>): SystemsTreeNode[] {
  const presetChildrenByCategory = new Map<string, SystemsTreeNode[]>();
  for (const system of FRACTAL_SYSTEMS) {
    if (!presetChildrenByCategory.has(system.category)) {
      presetChildrenByCategory.set(system.category, []);
    }
    presetChildrenByCategory.get(system.category)?.push({
      type: "leaf",
      id: `preset-leaf:${system.id}`,
      name: system.name,
      entryKey: makePresetEntryKey(system.id)
    });
  }

  const presetCategoryNodes: SystemsTreeNode[] = [...presetChildrenByCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, children]) => ({
      type: "folder",
      id: `preset-folder:${category}`,
      name: category,
      children: [...children].sort((a, b) => a.name.localeCompare(b.name))
    }));

  const localRoot: SystemsTreeFolderNode = {
    type: "folder",
    id: "local-root",
    name: "Local Storage",
    children: []
  };

  const ensureLocalFolder = (
    parent: SystemsTreeFolderNode,
    folderName: string,
    fullPath: string
  ): SystemsTreeFolderNode => {
    const existing = parent.children.find(
      (child) => child.type === "folder" && child.id === `local-folder:${fullPath}`
    );
    if (existing !== undefined && existing.type === "folder") {
      return existing;
    }

    const next: SystemsTreeFolderNode = {
      type: "folder",
      id: `local-folder:${fullPath}`,
      name: folderName,
      children: []
    };
    parent.children.push(next);
    return next;
  };

  for (const localPath of Object.keys(localSystemsByPath).sort((a, b) => a.localeCompare(b))) {
    const segments = localPath.split("/").filter((entry) => entry.length > 0);
    if (segments.length === 0) {
      continue;
    }

    let folder = localRoot;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i];
      const fullPath = segments.slice(0, i + 1).join("/");
      folder = ensureLocalFolder(folder, name, fullPath);
    }

    const leafName = segments[segments.length - 1];
    folder.children.push({
      type: "leaf",
      id: `local-leaf:${localPath}`,
      name: leafName,
      entryKey: makeLocalEntryKey(localPath),
      localPath
    });
  }

  const sortNodeChildren = (node: SystemsTreeFolderNode): void => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.type === "folder") {
        sortNodeChildren(child);
      }
    }
  };
  sortNodeChildren(localRoot);

  return [
    {
      type: "folder",
      id: "preset-root",
      name: "System Presets",
      children: presetCategoryNodes
    },
    localRoot
  ];
}

export function App(): JSX.Element {
  const initial = useMemo(buildInitialState, []);

  const [leftPanePx, setLeftPanePx] = useState(initial.leftPanePx);
  const [rightPanePx, setRightPanePx] = useState(initial.rightPanePx);
  const [leftSystemsPaneHeightPx, setLeftSystemsPaneHeightPx] = useState(initial.leftSystemsPaneHeightPx);
  const [selectedSystemKey, setSelectedSystemKey] = useState(initial.selectedSystemKey);
  const [activeIntegratorId, setActiveIntegratorId] = useState(initial.activeIntegratorId);

  const [localSystemsByPath, setLocalSystemsByPath] = useState(initial.localSystemsByPath);
  const [editorSourceBySystem, setEditorSourceBySystem] = useState(initial.editorSourceBySystem);
  const [uniformValuesBySystem, setUniformValuesBySystem] = useState(initial.uniformValuesBySystem);
  const [cameraBySystem, setCameraBySystem] = useState(initial.cameraBySystem);
  const [integratorOptionsById, setIntegratorOptionsById] = useState(initial.integratorOptionsById);
  const [renderSettings, setRenderSettings] = useState(initial.renderSettings);
  const [activeRightPaneTab, setActiveRightPaneTab] = useState<RightPaneTabId>("integrator");
  const [settingsClipboardStatus, setSettingsClipboardStatus] = useState<string | null>(null);
  const [saveLocalDialog, setSaveLocalDialog] = useState<SaveLocalDialogState | null>(null);
  const [deleteLocalDialogPath, setDeleteLocalDialogPath] = useState<string | null>(null);
  const [activeUniformGroupBySystem, setActiveUniformGroupBySystem] = useState<Record<string, string>>({});

  const [parsedBySystem, setParsedBySystem] = useState<Record<string, ParseResult>>({});
  const [activePresetBySystem, setActivePresetBySystem] = useState<Record<string, string>>({});

  const [status, setStatus] = useState<RendererStatus>({
    fps: 0,
    subframe: 0,
    scale: 1,
    resolution: [1, 1],
    maxSubframes: renderSettings.maxSubframes,
    tileCount: renderSettings.tileCount,
    tileCursor: 0
  });
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(initial.persistenceError);

  const selectedPresetId = parsePresetIdFromKey(selectedSystemKey);
  const selectedLocalPath = parseLocalPathFromKey(selectedSystemKey);
  const selectedPresetSystem = selectedPresetId !== null ? findPresetSystemById(selectedPresetId) : null;

  const baselineSource = getBaselineSourceForEntry(selectedSystemKey, localSystemsByPath);
  const sourceDraft = editorSourceBySystem[selectedSystemKey] ?? baselineSource;
  const parseResult = parsedBySystem[selectedSystemKey] ?? null;

  const activeIntegrator = getIntegratorById(activeIntegratorId);
  const activeIntegratorOptions =
    integratorOptionsById[activeIntegratorId] ?? getDefaultIntegratorOptions(activeIntegratorId);

  const uniformValues = parseResult
    ? uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms)
    : {};
  const uniformGroups = parseResult !== null ? getUniformGroupNames(parseResult.uniforms) : [];
  const activeUniformGroupFromTab = parseUniformGroupFromTabId(activeRightPaneTab);
  const selectedUniformGroup =
    uniformGroups.length === 0
      ? null
      : activeUniformGroupFromTab !== null && uniformGroups.includes(activeUniformGroupFromTab)
        ? activeUniformGroupFromTab
        : uniformGroups.includes(activeUniformGroupBySystem[selectedSystemKey] ?? "")
        ? (activeUniformGroupBySystem[selectedSystemKey] as string)
        : uniformGroups[0];
  const visibleUniforms =
    parseResult === null || selectedUniformGroup === null
      ? []
      : parseResult.uniforms.filter(
          (uniform) => normalizeUniformGroupName(uniform.group) === selectedUniformGroup
        );
  const rightPaneTabs: VerticalTabItem[] = useMemo(
    () => [
      ...STATIC_RIGHT_PANE_TABS,
      ...uniformGroups.map((group) => ({
        id: makeUniformGroupTabId(group),
        label: group
      }))
    ],
    [uniformGroups]
  );

  const cameraState = cameraBySystem[selectedSystemKey] ?? defaultCamera;
  const hasSourceChanges = sourceDraft !== baselineSource;
  const isEditingLocalSystem = selectedLocalPath !== null;
  const saveButtonLabel = isEditingLocalSystem ? "Update Local Storage" : "Save To Local Storage";
  const saveDialogNormalizedPath =
    saveLocalDialog === null ? null : normalizeLocalPath(saveLocalDialog.pathValue);
  const saveDialogIsOverwrite =
    saveDialogNormalizedPath !== null && localSystemsByPath[saveDialogNormalizedPath] !== undefined;

  const systemsTreeNodes = useMemo(
    () => buildSystemsTreeNodes(localSystemsByPath),
    [localSystemsByPath]
  );

  const compileSystem = useCallback(
    (entryKey: string): void => {
      const source = editorSourceBySystem[entryKey] ?? getBaselineSourceForEntry(entryKey, localSystemsByPath);

      try {
        const parsed = parseFragmentSource({
          source,
          sourceName: getSourceName(entryKey),
          includeMap: SYSTEM_INCLUDE_MAP
        });

        const existingValues = uniformValuesBySystem[entryKey];
        let nextValues = coerceUniformValues(parsed.uniforms, existingValues);

        if (existingValues === undefined) {
          const startupPreset = selectPresetForActivation(parsed, activePresetBySystem[entryKey]);
          if (startupPreset !== null) {
            nextValues = applyPresetValues(parsed.uniforms, nextValues, startupPreset);
            setActivePresetBySystem((prev) => ({ ...prev, [entryKey]: startupPreset.name }));
          }
        }

        const fallbackCamera = cameraBySystem[entryKey] ?? defaultCamera;
        const nextCamera = deriveCameraFromUniformValues(parsed.uniforms, nextValues, fallbackCamera);

        setParsedBySystem((prev) => ({ ...prev, [entryKey]: parsed }));
        setUniformValuesBySystem((prev) => ({ ...prev, [entryKey]: nextValues }));
        setCameraBySystem((prev) => ({ ...prev, [entryKey]: nextCamera }));

        setCompileError(null);
        console.info(`[app] Compiled '${entryKey}' successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setCompileError(message);
        console.error(`[app] Compile failed for '${entryKey}': ${message}`);
      }
    },
    [activePresetBySystem, cameraBySystem, editorSourceBySystem, localSystemsByPath, uniformValuesBySystem]
  );

  useEffect(() => {
    if (parsedBySystem[selectedSystemKey] === undefined) {
      compileSystem(selectedSystemKey);
    }
  }, [compileSystem, parsedBySystem, selectedSystemKey]);

  useEffect(() => {
    const parsed = parsedBySystem[selectedSystemKey];
    if (parsed === undefined) {
      return;
    }
    if (activePresetBySystem[selectedSystemKey] !== undefined) {
      return;
    }

    const startupPreset = selectPresetForActivation(parsed, undefined);
    if (startupPreset === null) {
      return;
    }

    const current = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parsed.uniforms);
    const nextValues = applyPresetValues(parsed.uniforms, current, startupPreset);
    const fallbackCamera = cameraBySystem[selectedSystemKey] ?? defaultCamera;
    const nextCamera = deriveCameraFromUniformValues(parsed.uniforms, nextValues, fallbackCamera);

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));
    setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextCamera }));
    setActivePresetBySystem((prev) => ({ ...prev, [selectedSystemKey]: startupPreset.name }));
  }, [
    activePresetBySystem,
    cameraBySystem,
    parsedBySystem,
    selectedSystemKey,
    uniformValuesBySystem
  ]);

  useEffect(() => {
    if (uniformGroups.length === 0 || selectedUniformGroup === null) {
      return;
    }
    if (activeUniformGroupBySystem[selectedSystemKey] === selectedUniformGroup) {
      return;
    }
    setActiveUniformGroupBySystem((prev) => ({
      ...prev,
      [selectedSystemKey]: selectedUniformGroup
    }));
  }, [
    activeUniformGroupBySystem,
    selectedSystemKey,
    selectedUniformGroup,
    uniformGroups
  ]);

  useEffect(() => {
    const hasActiveTab = rightPaneTabs.some((tab) => tab.id === activeRightPaneTab);
    if (hasActiveTab) {
      return;
    }
    if (selectedUniformGroup !== null) {
      setActiveRightPaneTab(makeUniformGroupTabId(selectedUniformGroup));
      return;
    }
    setActiveRightPaneTab(STATIC_RIGHT_PANE_TABS[0].id);
  }, [activeRightPaneTab, rightPaneTabs, selectedUniformGroup]);

  useEffect(() => {
    if (!isKnownSelectionKey(selectedSystemKey, localSystemsByPath)) {
      setSelectedSystemKey(makePresetEntryKey(FRACTAL_SYSTEMS[0].id));
    }
  }, [localSystemsByPath, selectedSystemKey]);

  useEffect(() => {
    const persisted = {
      leftPanePx,
      rightPanePx,
      leftSystemsPaneHeightPx,
      selectedSystemKey,
      activeIntegratorId,
      localSystemsByPath,
      editorSourceBySystem: filterToLocalEditorSources(editorSourceBySystem, localSystemsByPath),
      integratorOptionsById,
      uniformValuesBySystem,
      cameraBySystem,
      renderSettings
    };
    savePersistedState(persisted);
  }, [
    activeIntegratorId,
    cameraBySystem,
    editorSourceBySystem,
    integratorOptionsById,
    leftPanePx,
    localSystemsByPath,
    renderSettings,
    rightPanePx,
    leftSystemsPaneHeightPx,
    selectedSystemKey,
    uniformValuesBySystem
  ]);

  const onApplyPreset = (path: string): void => {
    if (parseResult === null) {
      return;
    }
    const preset = findPresetByPath(parseResult, path);
    if (preset === null) {
      return;
    }

    const current = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextValues = applyPresetValues(parseResult.uniforms, current, preset);

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));

    const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextValues, cameraState);
    setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextCamera }));
    setActivePresetBySystem((prev) => ({ ...prev, [selectedSystemKey]: path }));
  };

  const onUniformValueChange = (name: string, value: UniformValue): void => {
    if (parseResult === null) {
      return;
    }

    const definition = parseResult.uniforms.find((entry) => entry.name === name);
    if (definition === undefined) {
      return;
    }

    const sanitized = sanitizeUniformValue(definition, value);
    const currentValues = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextValues = {
      ...currentValues,
      [name]: sanitized
    };

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));

    if (name === "Eye" || name === "Target" || name === "Up" || name === "FOV") {
      const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextValues, cameraState);
      setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextCamera }));
    }
  };

  const onCameraChange = (next: CameraState): void => {
    setCameraBySystem((prev) => ({ ...prev, [selectedSystemKey]: next }));

    if (parseResult === null) {
      return;
    }

    const definitions = new Set(parseResult.uniforms.map((entry) => entry.name));
    if (!definitions.has("Eye") && !definitions.has("Target") && !definitions.has("Up") && !definitions.has("FOV")) {
      return;
    }

    const currentValues = uniformValuesBySystem[selectedSystemKey] ?? getDefaultUniformValues(parseResult.uniforms);
    const nextValues = {
      ...currentValues
    };

    if (definitions.has("Eye")) {
      nextValues.Eye = [...next.eye];
    }
    if (definitions.has("Target")) {
      nextValues.Target = [...next.target];
    }
    if (definitions.has("Up")) {
      nextValues.Up = [...next.up];
    }
    if (definitions.has("FOV")) {
      nextValues.FOV = next.fov;
    }

    setUniformValuesBySystem((prev) => ({ ...prev, [selectedSystemKey]: nextValues }));
  };

  const onIntegratorOptionChange = (key: string, value: number): void => {
    setIntegratorOptionsById((prev) => ({
      ...prev,
      [activeIntegratorId]: {
        ...(prev[activeIntegratorId] ?? getDefaultIntegratorOptions(activeIntegratorId)),
        [key]: value
      }
    }));
  };

  const onRenderSettingChange = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]): void => {
    setRenderSettings((prev) => coerceRenderSettings({ ...prev, [key]: value }));
  };

  const onCopySettingsToClipboard = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard API writeText is unavailable in this browser context.");
      }

      const payload = buildSettingsClipboardPayload({
        selectedPresetName: activePresetBySystem[selectedSystemKey] ?? null,
        integratorId: activeIntegratorId,
        integratorOptions: activeIntegratorOptions,
        renderSettings,
        uniformValues,
        camera: cameraState
      });

      await navigator.clipboard.writeText(serializeSettingsClipboardPayload(payload));
      setSettingsClipboardStatus("Settings copied to clipboard.");
      console.info(`[app] Copied settings for '${selectedSystemKey}' to clipboard.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsClipboardStatus(`Copy failed: ${message}`);
      console.error(`[app] Failed to copy settings: ${message}`);
    }
  };

  const onPasteSettingsFromClipboard = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || typeof navigator.clipboard.readText !== "function") {
        throw new Error("Clipboard API readText is unavailable in this browser context.");
      }

      const raw = await navigator.clipboard.readText();
      const payload = parseSettingsClipboardPayload(raw);

      const nextIntegratorId = normalizeIntegratorId(payload.integratorId);
      const hasIntegrator = INTEGRATORS.some((entry) => entry.id === nextIntegratorId);
      if (!hasIntegrator) {
        throw new Error(`Clipboard payload references unknown integrator '${payload.integratorId}'.`);
      }
      setActiveIntegratorId(nextIntegratorId);

      const nextIntegratorOptions = coerceIntegratorOptionsForId(nextIntegratorId, payload.integratorOptions);
      setIntegratorOptionsById((prev) => ({
        ...prev,
        [nextIntegratorId]: nextIntegratorOptions
      }));

      const nextRenderSettings = coerceRenderSettings(payload.renderSettings);
      setRenderSettings(nextRenderSettings);

      if (parseResult !== null) {
        const nextUniformValues = coerceUniformValues(parseResult.uniforms, payload.uniformValues);
        const nextCamera = deriveCameraFromUniformValues(parseResult.uniforms, nextUniformValues, payload.camera);

        setUniformValuesBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: nextUniformValues
        }));
        setCameraBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: nextCamera
        }));

        if (payload.selectedPresetName !== null) {
          const presetName = payload.selectedPresetName;
          const presetExists = parseResult.presets.some((preset) => preset.name === presetName);
          if (presetExists) {
            setActivePresetBySystem((prev) => ({
              ...prev,
              [selectedSystemKey]: presetName
            }));
          }
        }
      } else {
        setUniformValuesBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: payload.uniformValues
        }));
        setCameraBySystem((prev) => ({
          ...prev,
          [selectedSystemKey]: payload.camera
        }));
      }

      setSettingsClipboardStatus("Settings pasted from clipboard.");
      console.info(`[app] Pasted settings into '${selectedSystemKey}'.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsClipboardStatus(`Paste failed: ${message}`);
      console.error(`[app] Failed to paste settings: ${message}`);
    }
  };

  const onSwitchSystem = (entryKey: string): void => {
    setSelectedSystemKey(entryKey);
    if (parsedBySystem[entryKey] === undefined) {
      compileSystem(entryKey);
    }
  };

  const saveSourceToLocalPath = (normalizedPath: string): void => {
    const targetEntryKey = makeLocalEntryKey(normalizedPath);
    setLocalSystemsByPath((prev) => ({
      ...prev,
      [normalizedPath]: sourceDraft
    }));
    setEditorSourceBySystem((prev) => ({
      ...prev,
      [targetEntryKey]: sourceDraft
    }));
    setUniformValuesBySystem((prev) => {
      const current = prev[selectedSystemKey];
      if (current === undefined) {
        return prev;
      }
      return {
        ...prev,
        [targetEntryKey]: { ...current }
      };
    });
    setCameraBySystem((prev) => {
      const current = prev[selectedSystemKey];
      if (current === undefined) {
        return prev;
      }
      return {
        ...prev,
        [targetEntryKey]: {
          eye: [...current.eye],
          target: [...current.target],
          up: [...current.up],
          fov: current.fov
        }
      };
    });
    setActivePresetBySystem((prev) => {
      const current = prev[selectedSystemKey];
      if (current === undefined) {
        return prev;
      }
      return {
        ...prev,
        [targetEntryKey]: current
      };
    });
    setSelectedSystemKey(targetEntryKey);
  };

  const deleteLocalSystemByPath = (localPath: string): void => {
    const entryKey = makeLocalEntryKey(localPath);

    setLocalSystemsByPath((prev) => {
      const next = { ...prev };
      delete next[localPath];
      return next;
    });
    setEditorSourceBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setParsedBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setUniformValuesBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setCameraBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });
    setActivePresetBySystem((prev) => {
      const next = { ...prev };
      delete next[entryKey];
      return next;
    });

    if (selectedSystemKey === entryKey) {
      setSelectedSystemKey(makePresetEntryKey(FRACTAL_SYSTEMS[0].id));
    }
  };

  const onDeleteLocalSystem = (localPath: string): void => {
    setDeleteLocalDialogPath(localPath);
  };

  const onConfirmDeleteLocalSystem = (): void => {
    if (deleteLocalDialogPath === null) {
      return;
    }
    deleteLocalSystemByPath(deleteLocalDialogPath);
    setDeleteLocalDialogPath(null);
  };

  const onSaveOrUpdateSource = (): void => {
    if (!hasSourceChanges) {
      return;
    }

    if (isEditingLocalSystem && selectedLocalPath !== null) {
      setLocalSystemsByPath((prev) => ({
        ...prev,
        [selectedLocalPath]: sourceDraft
      }));
      setEditorSourceBySystem((prev) => ({
        ...prev,
        [selectedSystemKey]: sourceDraft
      }));
      return;
    }

    const suggestedName =
      selectedPresetSystem !== null ? `${selectedPresetSystem.id}/my-variant` : "local/custom-system";
    setSaveLocalDialog({
      pathValue: suggestedName,
      errorMessage: null
    });
  };

  const onCancelSaveLocalDialog = (): void => {
    setSaveLocalDialog(null);
  };

  const onConfirmSaveLocalDialog = (): void => {
    if (saveLocalDialog === null) {
      return;
    }

    const normalizedPath = normalizeLocalPath(saveLocalDialog.pathValue);
    if (normalizedPath === null) {
      setSaveLocalDialog((prev) => {
        if (prev === null) {
          return prev;
        }
        return {
          ...prev,
          errorMessage: "Invalid path. Please use a non-empty path like 'folder/name'."
        };
      });
      return;
    }

    saveSourceToLocalPath(normalizedPath);
    setSaveLocalDialog(null);
  };

  const onSwitchIntegrator = (integratorId: string): void => {
    setActiveIntegratorId(integratorId);
    setIntegratorOptionsById((prev) => {
      if (prev[integratorId] !== undefined) {
        return prev;
      }
      return {
        ...prev,
        [integratorId]: getDefaultIntegratorOptions(integratorId)
      };
    });
  };

  const leftPane = (
    <div className="pane-content left-pane left-pane-content">
      <VerticalSplitLayout
        topHeight={leftSystemsPaneHeightPx}
        minTopHeight={MIN_LEFT_SECTION_HEIGHT}
        minBottomHeight={MIN_LEFT_SECTION_HEIGHT}
        onTopHeightChange={setLeftSystemsPaneHeightPx}
        top={
          <section className="section-block section-fill">
            <h2>Systems</h2>
            <SystemsTreeView
              nodes={systemsTreeNodes}
              activeEntryKey={selectedSystemKey}
              onSelect={onSwitchSystem}
              onDeleteLocal={onDeleteLocalSystem}
            />
          </section>
        }
        bottom={
          <section className="section-block section-fill">
            <div className="section-header-row">
              <h2>Definition</h2>
              <div className="section-actions">
                <button type="button" onClick={() => compileSystem(selectedSystemKey)}>
                  Build (F5)
                </button>
                <button type="button" onClick={onSaveOrUpdateSource} disabled={!hasSourceChanges}>
                  {saveButtonLabel}
                </button>
              </div>
            </div>
            <DefinitionEditor
              value={sourceDraft}
              onChange={(next) => {
                setEditorSourceBySystem((prev) => ({ ...prev, [selectedSystemKey]: next }));
              }}
              onBuild={() => compileSystem(selectedSystemKey)}
            />
          </section>
        }
      />
    </div>
  );

  const centerPane = (
    <div className="pane-content center-pane">
      <ViewportPane
        geometrySource={parseResult?.shaderSource ?? "float DE(vec3 p){return length(p)-1.0;}"}
        uniformDefinitions={parseResult?.uniforms ?? []}
        uniformValues={uniformValues}
        integrator={activeIntegrator}
        integratorOptions={activeIntegratorOptions}
        renderSettings={renderSettings}
        cameraState={cameraState}
        onCameraChange={onCameraChange}
        onStatus={setStatus}
        onError={setShaderError}
      />
      <div className="viewport-overlay">
        <span>FPS {status.fps.toFixed(1)}</span>
        <span>
          Subframe {status.subframe}
          {status.maxSubframes === 0 ? "/inf" : `/${status.maxSubframes}`}
        </span>
        <span>Scale {status.scale.toFixed(2)}</span>
        <span>
          Tiles {status.tileCount}x{status.tileCount}
          {status.tileCount > 1 ? ` @${status.tileCursor + 1}` : ""}
        </span>
        <span>
          Buffer {status.resolution[0]}x{status.resolution[1]}
        </span>
      </div>
    </div>
  );

  const rightPane = (
    <div className="pane-content right-pane">
      <section className="section-block">
        <h2>Preset</h2>
        {parseResult !== null && parseResult.presets.length > 0 ? (
          <select
            value={activePresetBySystem[selectedSystemKey] ?? ""}
            onChange={(event) => {
              const presetName = event.target.value;
              if (presetName.length > 0) {
                onApplyPreset(presetName);
              }
            }}
          >
            <option value="" disabled>
              Select preset
            </option>
            {parseResult.presets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">No presets found in this source.</p>
        )}
      </section>

      <section className="section-block right-pane-tab-shell grow">
        <div className="right-pane-tab-content">
          {activeRightPaneTab === "integrator" ? (
            <>
              <h2>Integrator</h2>
              <select
                value={activeIntegratorId}
                onChange={(event) => onSwitchIntegrator(event.target.value)}
              >
                {INTEGRATORS.map((integrator) => (
                  <option key={integrator.id} value={integrator.id}>
                    {integrator.name}
                  </option>
                ))}
              </select>
              <p className="muted">{activeIntegrator.description}</p>

              <div className="integrator-options">
                {activeIntegrator.options.map((option) => {
                  const value = activeIntegratorOptions[option.key] ?? option.defaultValue;
                  return (
                    <div className="uniform-row" key={option.key}>
                      <span className="uniform-label">{option.label}</span>
                      <div className="uniform-inputs">
                        <input
                          type="range"
                          min={option.min}
                          max={option.max}
                          step={optionStep(option)}
                          value={value}
                          onChange={(event) => onIntegratorOptionChange(option.key, Number(event.target.value))}
                        />
                        <input
                          className="uniform-number"
                          type="number"
                          min={option.min}
                          max={option.max}
                          step={optionStep(option)}
                          value={value}
                          onChange={(event) => onIntegratorOptionChange(option.key, Number(event.target.value))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {activeRightPaneTab === "render" ? (
            <>
              <h2>Render</h2>
              <div className="integrator-options">
                <div className="uniform-row">
                  <span className="uniform-label">Move Res Scale</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0.25}
                      max={1}
                      step={0.05}
                      value={renderSettings.interactionResolutionScale}
                      onChange={(event) =>
                        onRenderSettingChange("interactionResolutionScale", Number(event.target.value))
                      }
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0.25}
                      max={1}
                      step={0.05}
                      value={renderSettings.interactionResolutionScale}
                      onChange={(event) =>
                        onRenderSettingChange("interactionResolutionScale", Number(event.target.value))
                      }
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Max Subframes</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0}
                      max={200}
                      step={1}
                      value={renderSettings.maxSubframes}
                      onChange={(event) => onRenderSettingChange("maxSubframes", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      value={renderSettings.maxSubframes}
                      onChange={(event) => onRenderSettingChange("maxSubframes", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Tile Count</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={renderSettings.tileCount}
                      onChange={(event) => onRenderSettingChange("tileCount", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={1}
                      max={8}
                      step={1}
                      value={renderSettings.tileCount}
                      onChange={(event) => onRenderSettingChange("tileCount", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Tiles/Frame</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={1}
                      max={16}
                      step={1}
                      value={renderSettings.tilesPerFrame}
                      onChange={(event) => onRenderSettingChange("tilesPerFrame", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={1}
                      max={16}
                      step={1}
                      value={renderSettings.tilesPerFrame}
                      onChange={(event) => onRenderSettingChange("tilesPerFrame", Number(event.target.value))}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {activeRightPaneTab === "post" ? (
            <>
              <h2>Post</h2>
              <div className="integrator-options">
                <div className="uniform-row">
                  <span className="uniform-label">Tone Mapping</span>
                  <div className="uniform-inputs">
                    <select
                      value={renderSettings.toneMapping}
                      onChange={(event) => onRenderSettingChange("toneMapping", Number(event.target.value))}
                    >
                      <option value={1}>Linear</option>
                      <option value={2}>Exponential</option>
                      <option value={3}>Filmic (ACES-like)</option>
                      <option value={4}>Reinhard</option>
                    </select>
                    <input
                      className="uniform-number"
                      type="number"
                      min={1}
                      max={4}
                      step={1}
                      value={renderSettings.toneMapping}
                      onChange={(event) => onRenderSettingChange("toneMapping", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Exposure</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.01}
                      value={renderSettings.exposure}
                      onChange={(event) => onRenderSettingChange("exposure", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={8}
                      step={0.01}
                      value={renderSettings.exposure}
                      onChange={(event) => onRenderSettingChange("exposure", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Gamma</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0.2}
                      max={5}
                      step={0.01}
                      value={renderSettings.gamma}
                      onChange={(event) => onRenderSettingChange("gamma", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0.2}
                      max={5}
                      step={0.01}
                      value={renderSettings.gamma}
                      onChange={(event) => onRenderSettingChange("gamma", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Brightness</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.brightness}
                      onChange={(event) => onRenderSettingChange("brightness", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.brightness}
                      onChange={(event) => onRenderSettingChange("brightness", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Contrast</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.contrast}
                      onChange={(event) => onRenderSettingChange("contrast", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.contrast}
                      onChange={(event) => onRenderSettingChange("contrast", Number(event.target.value))}
                    />
                  </div>
                </div>

                <div className="uniform-row">
                  <span className="uniform-label">Saturation</span>
                  <div className="uniform-inputs">
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.saturation}
                      onChange={(event) => onRenderSettingChange("saturation", Number(event.target.value))}
                    />
                    <input
                      className="uniform-number"
                      type="number"
                      min={0}
                      max={5}
                      step={0.01}
                      value={renderSettings.saturation}
                      onChange={(event) => onRenderSettingChange("saturation", Number(event.target.value))}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {selectedUniformGroup !== null && activeRightPaneTab === makeUniformGroupTabId(selectedUniformGroup) ? (
            <>
              <div className="right-pane-uniforms">
                {parseResult !== null ? (
                  visibleUniforms.length > 0 ? (
                    <UniformPanel
                      uniforms={visibleUniforms}
                      values={uniformValues}
                      onChange={onUniformValueChange}
                    />
                  ) : (
                    <p className="muted">No parameters in this group.</p>
                  )
                ) : (
                  <p className="muted">Compile a system to expose parameters.</p>
                )}
              </div>
            </>
          ) : null}
        </div>

        <VerticalTabList
          tabs={rightPaneTabs}
          activeTabId={activeRightPaneTab}
          onChange={(tabId) => setActiveRightPaneTab(tabId)}
        />
      </section>

      <section className="section-block">
        <div className="settings-clipboard-actions">
          <button type="button" onClick={() => void onCopySettingsToClipboard()}>
            Copy to Clipboard
          </button>
          <button type="button" onClick={() => void onPasteSettingsFromClipboard()}>
            Paste from Clipboard
          </button>
        </div>
        {settingsClipboardStatus !== null ? <p className="muted">{settingsClipboardStatus}</p> : null}
      </section>
    </div>
  );

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-title">Fragmentarium Web</div>
      </header>

      <SplitLayout
        leftWidth={leftPanePx}
        rightWidth={rightPanePx}
        minPaneWidth={MIN_PANE_WIDTH}
        onLeftWidthChange={setLeftPanePx}
        onRightWidthChange={setRightPanePx}
        left={leftPane}
        center={centerPane}
        right={rightPane}
      />

      {(compileError !== null || shaderError !== null) && (
        <div className="error-strip">
          {compileError !== null ? <span>Compile error: {compileError}</span> : null}
          {shaderError !== null ? <span>Shader error: {shaderError}</span> : null}
        </div>
      )}

      <SaveLocalSystemDialog
        open={saveLocalDialog !== null}
        pathValue={saveLocalDialog?.pathValue ?? ""}
        errorMessage={saveLocalDialog?.errorMessage ?? null}
        isOverwrite={saveDialogIsOverwrite}
        onPathChange={(next) =>
          setSaveLocalDialog((prev) => {
            if (prev === null) {
              return prev;
            }
            return {
              pathValue: next,
              errorMessage: null
            };
          })
        }
        onCancel={onCancelSaveLocalDialog}
        onSave={onConfirmSaveLocalDialog}
      />
      <ConfirmDeleteLocalSystemDialog
        open={deleteLocalDialogPath !== null}
        localPath={deleteLocalDialogPath}
        onCancel={() => setDeleteLocalDialogPath(null)}
        onConfirm={onConfirmDeleteLocalSystem}
      />
    </div>
  );
}
