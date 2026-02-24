import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { AppButton } from "./AppButton";

export const LOCAL_SESSION_GALLERY_ROOT_LABEL = "Local Sessions";

export interface SessionGalleryItem {
  id: string;
  path: string;
  tileLabel?: string;
  previewUrl: string;
  createdAtMs: number | null;
  updatedAtMs: number;
  sourceKind: "local" | "github";
  localPath?: string;
  remotePngUrl?: string;
}

export interface SessionGalleryExternalSource {
  id: string;
  label: string;
  url: string;
  treePath: string;
  itemCount: number;
  status: "idle" | "loading" | "ready" | "error";
  errorMessage: string | null;
}

export interface SessionGalleryStorageInfo {
  snapshotStorageBytes: number;
  originUsageBytes: number | null;
  originQuotaBytes: number | null;
  persistentStorageStatus: "enabled" | "disabled" | "unavailable" | "unknown";
}

interface SessionGalleryDialogProps {
  open: boolean;
  items: SessionGalleryItem[];
  externalSources: SessionGalleryExternalSource[];
  storageInfo: SessionGalleryStorageInfo;
  isBusy: boolean;
  persistentStorageRequestInProgress: boolean;
  onClose: () => void;
  onOpenSession: (item: SessionGalleryItem) => void;
  onDeleteSession: (path: string) => void;
  onRenameSession: (fromPath: string, toPath: string) => Promise<void> | void;
  onRequestPersistentStorage: () => Promise<void> | void;
  onExportAll: () => void;
  onImportZip: (file: File) => Promise<void> | void;
  onAddExternalGitHubSource: (url: string) => Promise<void> | void;
  onRefreshExternalSource: (sourceId: string) => Promise<void> | void;
  onRemoveExternalSource: (sourceId: string) => void;
}

interface GalleryFolderNode {
  id: string;
  name: string;
  path: string;
  children: GalleryFolderNode[];
  itemCount: number;
  directItemCount: number;
  externalSource: SessionGalleryExternalSource | null;
}

const DEFAULT_THUMB_SIZE = 184;
const MIN_THUMB_SIZE = 96;
const MAX_THUMB_SIZE = 320;
const TILE_STAGGER_MS = 25;
const TILE_STAGGER_MAX_INDEX = 40;
const DEFAULT_GALLERY_SIDEBAR_WIDTH_PX = 300;
const MIN_GALLERY_SIDEBAR_WIDTH_PX = 180;
const MIN_GALLERY_GRID_WIDTH_PX = 240;
const GALLERY_SPLITTER_WIDTH_PX = 10;
const MIN_GALLERY_DIALOG_WIDTH_PX = 680;
const MIN_GALLERY_DIALOG_HEIGHT_PX = 460;
const GALLERY_DIALOG_VIEWPORT_MARGIN_PX = 24;
const DEFAULT_EXTERNAL_GITHUB_SOURCE_URL =
  "https://github.com/Syntopia/FragmentariumWeb/tree/main/factory%20sessions/sessions";
type SessionGalleryTileSortMode = "name" | "date";

function buildFolderTree(items: SessionGalleryItem[], externalSources: SessionGalleryExternalSource[]): GalleryFolderNode {
  const root: GalleryFolderNode = {
    id: "root",
    name: "All Sessions",
    path: "",
    children: [],
    itemCount: items.length,
    directItemCount: 0,
    externalSource: null
  };

  const childMap = new Map<string, GalleryFolderNode>();
  childMap.set("", root);
  const externalSourceByTreePath = new Map<string, SessionGalleryExternalSource>(
    externalSources.map((source) => [source.treePath, source] as const)
  );

  const ensureFolderPath = (folderPath: string): GalleryFolderNode => {
    const normalized = folderPath.trim();
    if (normalized.length === 0) {
      return root;
    }
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    let parentPath = "";
    for (const segment of segments) {
      const nextPath = parentPath.length === 0 ? segment : `${parentPath}/${segment}`;
      let node = childMap.get(nextPath);
      if (node === undefined) {
        node = {
          id: `folder:${nextPath}`,
          name: segment,
          path: nextPath,
          children: [],
          itemCount: 0,
          directItemCount: 0,
          externalSource: null
        };
        childMap.set(nextPath, node);
        const parent = childMap.get(parentPath);
        if (parent === undefined) {
          throw new Error(`Gallery folder tree build failed: missing parent '${parentPath}'.`);
        }
        parent.children.push(node);
      }
      parentPath = nextPath;
    }
    const node = childMap.get(parentPath);
    if (node === undefined) {
      throw new Error(`Gallery folder tree build failed: failed to create folder '${folderPath}'.`);
    }
    return node;
  };

  for (const item of items) {
    const segments = item.path.split("/").filter((segment) => segment.length > 0);
    let parentPath = "";
    for (let index = 0; index < Math.max(0, segments.length - 1); index += 1) {
      const segment = segments[index];
      const nextPath = parentPath.length === 0 ? segment : `${parentPath}/${segment}`;
      let node = childMap.get(nextPath);
      if (node === undefined) {
        node = {
          id: `folder:${nextPath}`,
          name: segment,
          path: nextPath,
          children: [],
          itemCount: 0,
          directItemCount: 0,
          externalSource: null
        };
        childMap.set(nextPath, node);
        const parent = childMap.get(parentPath);
        if (parent === undefined) {
          throw new Error(`Gallery folder tree build failed: missing parent '${parentPath}'.`);
        }
        parent.children.push(node);
      }
      node.itemCount += 1;
      parentPath = nextPath;
    }
    const parent = childMap.get(parentPath);
    if (parent === undefined) {
      throw new Error(`Gallery folder tree build failed: missing leaf parent '${parentPath}'.`);
    }
    parent.directItemCount += 1;
  }

  for (const source of externalSources) {
    const node = ensureFolderPath(source.treePath);
    node.externalSource = source;
    node.name = externalSourceShortLabel(source);
  }

  const sortNodes = (node: GalleryFolderNode): void => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) {
      sortNodes(child);
    }
  };
  sortNodes(root);
  const compressionProtectedPaths = new Set<string>([
    LOCAL_SESSION_GALLERY_ROOT_LABEL,
    "GitHub",
    ...externalSources.map((source) => source.treePath)
  ]);
  return compressFolderChains(root, true, compressionProtectedPaths);
}

function compressFolderChains(node: GalleryFolderNode, isRoot: boolean, protectedPaths: Set<string>): GalleryFolderNode {
  let next: GalleryFolderNode = {
    ...node,
    children: node.children.map((child) => compressFolderChains(child, false, protectedPaths))
  };

  if (isRoot || protectedPaths.has(next.path) || next.externalSource !== null) {
    return next;
  }

  while (next.directItemCount === 0 && next.children.length === 1) {
    const child = next.children[0];
    if (protectedPaths.has(child.path) || child.externalSource !== null) {
      break;
    }
    next = {
      id: `folder:${child.path}`,
      name: `${next.name}/${child.name}`,
      path: child.path,
      children: child.children,
      itemCount: child.itemCount,
      directItemCount: child.directItemCount,
      externalSource: child.externalSource
    };
  }

  return next;
}

function pathBelongsToFolder(itemPath: string, folderPath: string): boolean {
  if (folderPath.length === 0) {
    return true;
  }
  return itemPath === folderPath || itemPath.startsWith(`${folderPath}/`);
}

function folderTreeHasPath(node: GalleryFolderNode, path: string): boolean {
  if (node.path === path) {
    return true;
  }
  return node.children.some((child) => folderTreeHasPath(child, path));
}

function clampThumbSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THUMB_SIZE;
  }
  return Math.max(MIN_THUMB_SIZE, Math.min(MAX_THUMB_SIZE, Math.round(value)));
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "Unavailable";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function persistentStorageStatusLabel(status: SessionGalleryStorageInfo["persistentStorageStatus"]): string {
  switch (status) {
    case "enabled":
      return "Enabled";
    case "disabled":
      return "Not enabled";
    case "unavailable":
      return "Unavailable";
    default:
      return "Checking...";
  }
}

function externalSourceCountBadgeLabel(source: SessionGalleryExternalSource): string {
  return String(source.itemCount);
}

function externalSourceShortLabel(source: SessionGalleryExternalSource): string {
  const rawLabel = source.label.trim();
  if (rawLabel.startsWith("GH ")) {
    const withoutPrefix = rawLabel.slice(3);
    const atIndex = withoutPrefix.indexOf("@");
    const beforeAt = atIndex > 0 ? withoutPrefix.slice(0, atIndex) : withoutPrefix;
    const parts = beforeAt
      .split(" > ")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return withoutPrefix;
  }
  const atIndex = rawLabel.indexOf("@");
  if (atIndex > 0) {
    return rawLabel.slice(0, atIndex);
  }
  return rawLabel;
}

function externalSourceRowTitle(source: SessionGalleryExternalSource): string {
  const lines = [source.label, source.url];
  if (source.errorMessage !== null) {
    lines.push(source.errorMessage);
  }
  return lines.join("\n");
}

function formatGalleryTileDateLabel(timestampMs: number | null): string {
  if (timestampMs === null || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "Unavailable";
  }
  return new Date(timestampMs).toLocaleString();
}

function buildSessionGalleryTileTitle(item: SessionGalleryItem): string {
  const lines = [item.path];
  if (item.sourceKind === "local") {
    lines.push(`Created: ${formatGalleryTileDateLabel(item.createdAtMs)}`);
    lines.push(`Updated: ${formatGalleryTileDateLabel(item.updatedAtMs)}`);
  }
  return lines.join("\n");
}

function compareSessionGalleryItems(a: SessionGalleryItem, b: SessionGalleryItem, sortMode: SessionGalleryTileSortMode): number {
  if (sortMode === "date") {
    const byDate = b.updatedAtMs - a.updatedAtMs;
    if (byDate !== 0) {
      return byDate;
    }
  }
  const aLabel = a.tileLabel ?? a.path;
  const bLabel = b.tileLabel ?? b.path;
  const byLabel = aLabel.localeCompare(bLabel);
  if (byLabel !== 0) {
    return byLabel;
  }
  return a.path.localeCompare(b.path);
}

export function SessionGalleryDialog(props: SessionGalleryDialogProps): JSX.Element | null {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipDropDepthRef = useRef(0);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const resizeStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>("");
  const [selectedSessionPath, setSelectedSessionPath] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [tileSortMode, setTileSortMode] = useState<SessionGalleryTileSortMode>("name");
  const [thumbSizePx, setThumbSizePx] = useState(DEFAULT_THUMB_SIZE);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(DEFAULT_GALLERY_SIDEBAR_WIDTH_PX);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dialogSizePx, setDialogSizePx] = useState<{ width: number; height: number } | null>(null);
  const [tileAnimationEpoch, setTileAnimationEpoch] = useState(0);
  const [renameSourcePath, setRenameSourcePath] = useState<string | null>(null);
  const [renameDraftPath, setRenameDraftPath] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameInProgress, setRenameInProgress] = useState(false);
  const [zipDropActive, setZipDropActive] = useState(false);
  const [externalUrlInput, setExternalUrlInput] = useState("");
  const [addExternalInProgress, setAddExternalInProgress] = useState(false);
  const [externalUrlError, setExternalUrlError] = useState<string | null>(null);
  const [externalAddDialogOpen, setExternalAddDialogOpen] = useState(false);

  const sortedItems = useMemo(
    () => [...props.items].sort((a, b) => a.path.localeCompare(b.path)),
    [props.items]
  );
  const localItemCount = useMemo(
    () => props.items.filter((item) => item.sourceKind === "local").length,
    [props.items]
  );
  const folderTree = useMemo(() => buildFolderTree(sortedItems, props.externalSources), [props.externalSources, sortedItems]);
  const normalizedNameFilter = nameFilter.trim().toLowerCase();
  const filteredItems = useMemo(
    () =>
      sortedItems.filter(
        (item) =>
          pathBelongsToFolder(item.path, selectedFolderPath) &&
          (normalizedNameFilter.length === 0 || item.path.toLowerCase().includes(normalizedNameFilter))
      ),
    [normalizedNameFilter, selectedFolderPath, sortedItems]
  );
  const displayItems = useMemo(
    () => [...filteredItems].sort((a, b) => compareSessionGalleryItems(a, b, tileSortMode)),
    [filteredItems, tileSortMode]
  );
  const selectedItem = useMemo(
    () => sortedItems.find((item) => item.path === selectedSessionPath) ?? null,
    [selectedSessionPath, sortedItems]
  );

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setSelectedFolderPath((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const folderStillExists = prev
        .split("/")
        .filter((segment) => segment.length > 0)
        .every((_segment, index, segments) => {
          const path = segments.slice(0, index + 1).join("/");
          return folderTreeHasPath(folderTree, path);
        });
      return folderStillExists ? prev : "";
    });
    setSelectedSessionPath((prev) => (prev !== null && sortedItems.some((item) => item.path === prev) ? prev : sortedItems[0]?.path ?? null));
  }, [folderTree, props.open, sortedItems]);

  useEffect(() => {
    if (selectedSessionPath === null) {
      return;
    }
    if (!pathBelongsToFolder(selectedSessionPath, selectedFolderPath)) {
      setSelectedSessionPath(displayItems[0]?.path ?? null);
    }
  }, [displayItems, selectedFolderPath, selectedSessionPath]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setTileAnimationEpoch((prev) => prev + 1);
  }, [displayItems.length, nameFilter, props.open, selectedFolderPath, tileSortMode]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setRenameSourcePath(null);
    setRenameDraftPath(null);
    setRenameError(null);
    setRenameInProgress(false);
    setZipDropActive(false);
    setExternalUrlError(null);
    setAddExternalInProgress(false);
    setExternalAddDialogOpen(false);
    zipDropDepthRef.current = 0;
  }, [props.open]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setDragOffset({ x: 0, y: 0 });
    setDialogSizePx(null);
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const renderFolderNode = (node: GalleryFolderNode, depth: number): JSX.Element => {
    const isSelected = node.path === selectedFolderPath;
    const externalSource = node.externalSource;
    const folderCountClassName =
      externalSource === null
        ? "session-gallery-folder-count"
        : `session-gallery-folder-count is-external-status is-${externalSource.status}`;
    const folderCountTitle =
      externalSource === null
        ? undefined
        : `Status: ${externalSource.status}. Entries: ${externalSource.itemCount}${
            externalSource.errorMessage !== null ? `\n${externalSource.errorMessage}` : ""
          }`;
    return (
      <div key={node.id} className="session-gallery-folder-node">
        <div className="session-gallery-folder-row">
          <button
            type="button"
            className={`session-gallery-folder-button${isSelected ? " is-active" : ""}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => setSelectedFolderPath(node.path)}
            title={externalSource !== null ? externalSourceRowTitle(externalSource) : undefined}
          >
            <span className="session-gallery-folder-name">
              {externalSource !== null ? externalSourceShortLabel(externalSource) : node.name}
            </span>
            {externalSource === null ? (
              <span className={folderCountClassName} title={folderCountTitle}>
                {node.itemCount}
              </span>
            ) : null}
          </button>
          {externalSource !== null ? (
            <>
              <div className="session-gallery-folder-row-actions">
                <AppButton
                  variant="ghost"
                  className="session-gallery-folder-row-action session-gallery-folder-row-action-refresh"
                  onClick={(event) => {
                    event.stopPropagation();
                    void props.onRefreshExternalSource(externalSource.id);
                  }}
                  disabled={props.isBusy || externalSource.status === "loading"}
                  aria-label={`Refresh ${externalSource.label}`}
                  title={`Refresh (${externalSource.itemCount} entries)`}
                >
                  ↻
                </AppButton>
                <AppButton
                  variant="ghost"
                  className="session-gallery-folder-row-action session-gallery-folder-row-action-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onRemoveExternalSource(externalSource.id);
                  }}
                  disabled={props.isBusy || externalSource.status === "loading"}
                  aria-label={`Remove ${externalSource.label}`}
                  title="Remove source"
                >
                  X
                </AppButton>
              </div>
              <span
                className={`${folderCountClassName} session-gallery-folder-row-status-badge`}
                title={folderCountTitle}
              >
                {externalSourceCountBadgeLabel(externalSource)}
              </span>
            </>
          ) : null}
        </div>
        {node.children.map((child) => renderFolderNode(child, depth + 1))}
      </div>
    );
  };

  const canOpenSelected = selectedItem !== null && !props.isBusy;
  const canDeleteSelected = selectedItem !== null && selectedItem.sourceKind === "local" && !props.isBusy;
  const canRenameSelected = selectedItem !== null && selectedItem.sourceKind === "local" && !props.isBusy && !renameInProgress;
  const canExportAll = localItemCount > 0 && !props.isBusy;
  const renameEditorOpen = renameSourcePath !== null && renameDraftPath !== null;

  const beginRenameSelected = (): void => {
    if (selectedItem === null || selectedItem.sourceKind !== "local" || selectedItem.localPath === undefined || props.isBusy) {
      return;
    }
    setRenameSourcePath(selectedItem.localPath);
    setRenameDraftPath(selectedItem.localPath);
    setRenameError(null);
  };

  const cancelRename = (): void => {
    if (renameInProgress) {
      return;
    }
    setRenameSourcePath(null);
    setRenameDraftPath(null);
    setRenameError(null);
  };

  const submitRename = async (): Promise<void> => {
    if (renameSourcePath === null || renameDraftPath === null || props.isBusy) {
      return;
    }
    setRenameError(null);
    setRenameInProgress(true);
    try {
      await props.onRenameSession(renameSourcePath, renameDraftPath);
      setSelectedSessionPath(`${LOCAL_SESSION_GALLERY_ROOT_LABEL}/${renameDraftPath}`);
      setRenameSourcePath(null);
      setRenameDraftPath(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenameInProgress(false);
    }
  };

  const onZipDropDragEnter = (event: ReactDragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    zipDropDepthRef.current += 1;
    setZipDropActive(true);
  };

  const onZipDropDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!zipDropActive) {
      setZipDropActive(true);
    }
  };

  const onZipDropDragLeave = (event: ReactDragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    zipDropDepthRef.current = Math.max(0, zipDropDepthRef.current - 1);
    if (zipDropDepthRef.current === 0) {
      setZipDropActive(false);
    }
  };

  const onZipDrop = (event: ReactDragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    zipDropDepthRef.current = 0;
    setZipDropActive(false);

    if (props.isBusy) {
      return;
    }
    const files = [...event.dataTransfer.files];
    if (files.length !== 1) {
      return;
    }
    const file = files[0];
    if (!(file.type === "application/zip" || file.name.toLowerCase().endsWith(".zip"))) {
      return;
    }
    void props.onImportZip(file);
  };

  const submitExternalSource = async (): Promise<void> => {
    const trimmed = externalUrlInput.trim();
    if (trimmed.length === 0 || props.isBusy || addExternalInProgress) {
      return;
    }
    setExternalUrlError(null);
    setAddExternalInProgress(true);
    try {
      await props.onAddExternalGitHubSource(trimmed);
      setExternalUrlInput("");
      setExternalAddDialogOpen(false);
    } catch (error) {
      setExternalUrlError(error instanceof Error ? error.message : String(error));
    } finally {
      setAddExternalInProgress(false);
    }
  };

  const closeExternalAddDialog = (): void => {
    if (addExternalInProgress) {
      return;
    }
    setExternalAddDialogOpen(false);
    setExternalUrlError(null);
  };

  const onStartSidebarResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const layout = layoutRef.current;
    if (layout === null) {
      return;
    }
    event.preventDefault();

    const rect = layout.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = sidebarWidthPx;

    const onMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      const maxWidth = Math.max(
        MIN_GALLERY_SIDEBAR_WIDTH_PX,
        rect.width - MIN_GALLERY_GRID_WIDTH_PX - GALLERY_SPLITTER_WIDTH_PX
      );
      const next = Math.max(
        MIN_GALLERY_SIDEBAR_WIDTH_PX,
        Math.min(maxWidth, Math.round(startWidth + deltaX))
      );
      setSidebarWidthPx(next);
    };

    const onDone = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onDone);
      window.removeEventListener("pointercancel", onDone);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onDone);
    window.addEventListener("pointercancel", onDone);
  };

  const onStartDialogResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = dialog.getBoundingClientRect();
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDialogResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeStateRef.current;
    if (resize === null || resize.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - resize.startClientX;
    const deltaY = event.clientY - resize.startClientY;
    const maxWidth = Math.max(
      MIN_GALLERY_DIALOG_WIDTH_PX,
      window.innerWidth - GALLERY_DIALOG_VIEWPORT_MARGIN_PX
    );
    const maxHeight = Math.max(
      MIN_GALLERY_DIALOG_HEIGHT_PX,
      window.innerHeight - GALLERY_DIALOG_VIEWPORT_MARGIN_PX
    );
    const nextWidth = Math.max(
      MIN_GALLERY_DIALOG_WIDTH_PX,
      Math.min(maxWidth, Math.round(resize.startWidth + deltaX))
    );
    const nextHeight = Math.max(
      MIN_GALLERY_DIALOG_HEIGHT_PX,
      Math.min(maxHeight, Math.round(resize.startHeight + deltaY))
    );
    setDialogSizePx({ width: nextWidth, height: nextHeight });
  };

  const onDialogResizePointerDone = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeStateRef.current;
    if (resize !== null && resize.pointerId === event.pointerId) {
      resizeStateRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const dialogStyle: CSSProperties = {
    transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`
  };
  if (dialogSizePx !== null) {
    dialogStyle.width = `${dialogSizePx.width}px`;
    dialogStyle.height = `${dialogSizePx.height}px`;
  }

  return (
    <div
      className="modal-backdrop"
      onDragEnter={onZipDropDragEnter}
      onDragOver={onZipDropDragOver}
      onDragLeave={onZipDropDragLeave}
      onDrop={onZipDrop}
    >
      <div
        ref={dialogRef}
        className="modal-window session-gallery-modal-window"
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-gallery-title"
      >
        <div className="session-gallery-header">
          <div
            className="session-gallery-header-drag"
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();
              dragStateRef.current = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startOffsetX: dragOffset.x,
                startOffsetY: dragOffset.y
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragStateRef.current;
              if (drag === null || drag.pointerId !== event.pointerId) {
                return;
              }
              const nextX = drag.startOffsetX + (event.clientX - drag.startClientX);
              const nextY = drag.startOffsetY + (event.clientY - drag.startClientY);
              setDragOffset({ x: Math.round(nextX), y: Math.round(nextY) });
            }}
            onPointerUp={(event) => {
              const drag = dragStateRef.current;
              if (drag !== null && drag.pointerId === event.pointerId) {
                dragStateRef.current = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              const drag = dragStateRef.current;
              if (drag !== null && drag.pointerId === event.pointerId) {
                dragStateRef.current = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            <h3 id="session-gallery-title">Session Gallery</h3>
          </div>
          <div className="session-gallery-header-actions">
            <AppButton onClick={props.onExportAll} disabled={!canExportAll}>Export All ZIP</AppButton>
            <AppButton
              onClick={() => {
                fileInputRef.current?.click();
              }}
              disabled={props.isBusy}
            >
              Import ZIP...
            </AppButton>
            <AppButton onClick={props.onClose} disabled={props.isBusy}>Close</AppButton>
          </div>
        </div>

        <div className="session-gallery-toolbar">
          <div className="session-gallery-toolbar-right">
            <label className="session-gallery-sort-field">
              <span className="muted">Sort</span>
              <select
                className="modal-input session-gallery-sort-select"
                value={tileSortMode}
                onChange={(event) => setTileSortMode(event.target.value as SessionGalleryTileSortMode)}
                disabled={props.isBusy}
              >
                <option value="name">Name</option>
                <option value="date">Date</option>
              </select>
            </label>
            <div className="session-gallery-zoom">
              <span className="muted">Zoom</span>
              <AppButton
                onClick={() => setThumbSizePx((prev) => clampThumbSize(prev - 24))}
                disabled={props.isBusy || thumbSizePx <= MIN_THUMB_SIZE}
              >
                -
              </AppButton>
              <input
                type="range"
                min={MIN_THUMB_SIZE}
                max={MAX_THUMB_SIZE}
                step={8}
                value={thumbSizePx}
                disabled={props.isBusy}
                onChange={(event) => setThumbSizePx(clampThumbSize(event.target.valueAsNumber))}
              />
              <AppButton
                onClick={() => setThumbSizePx((prev) => clampThumbSize(prev + 24))}
                disabled={props.isBusy || thumbSizePx >= MAX_THUMB_SIZE}
              >
                +
              </AppButton>
            </div>
          </div>
        </div>

        {renameEditorOpen ? (
          <div className="session-gallery-rename-row">
            <label className="session-gallery-rename-field">
              <span className="muted">Rename To</span>
              <input
                type="text"
                className="modal-input session-gallery-rename-input"
                value={renameDraftPath ?? ""}
                disabled={props.isBusy || renameInProgress}
                onChange={(event) => {
                  setRenameDraftPath(event.target.value);
                  if (renameError !== null) {
                    setRenameError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                spellCheck={false}
              />
            </label>
            <div className="session-gallery-rename-actions">
              <AppButton
                variant="primary"
                onClick={() => void submitRename()}
                disabled={props.isBusy || renameInProgress}
              >
                {renameInProgress ? "Renaming..." : "Rename"}
              </AppButton>
              <AppButton onClick={cancelRename} disabled={renameInProgress}>Cancel</AppButton>
            </div>
            {renameError !== null ? <p className="dialog-error session-gallery-rename-error">{renameError}</p> : null}
          </div>
        ) : null}

        <div
          ref={layoutRef}
          className="session-gallery-layout"
          style={{ ["--session-gallery-sidebar-width" as string]: `${sidebarWidthPx}px` }}
        >
          <div className="session-gallery-sidebar">
            <div className="session-gallery-sidebar-filter">
              <label className="session-gallery-filter-field">
                <span className="muted">Filter</span>
                <input
                  type="text"
                  className="modal-input session-gallery-filter-input"
                  value={nameFilter}
                  onChange={(event) => setNameFilter(event.target.value)}
                  placeholder="Search session name/path..."
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="session-gallery-sidebar-tree">
              {renderFolderNode(folderTree, 0)}
            </div>
            <div className="session-gallery-sidebar-external">
              <AppButton
                className="session-gallery-sidebar-add-source-button"
                onClick={() => {
                  setExternalUrlInput(DEFAULT_EXTERNAL_GITHUB_SOURCE_URL);
                  setExternalAddDialogOpen(true);
                  setExternalUrlError(null);
                }}
                disabled={props.isBusy || addExternalInProgress}
              >
                Add External GitHub Folder...
              </AppButton>
            </div>
          </div>
          <div
            className="session-gallery-splitter"
            role="separator"
            aria-label="Resize session gallery tree and tiles"
            aria-orientation="vertical"
            onPointerDown={onStartSidebarResize}
          />
          <div className="session-gallery-grid-panel">
            <div className="session-gallery-grid-scroll">
              {displayItems.length === 0 ? (
                <div className="session-gallery-empty muted">No sessions in this folder.</div>
              ) : (
                <div
                  className="session-gallery-grid"
                  style={{ ["--session-gallery-thumb-size" as string]: `${thumbSizePx}px` }}
                >
                  {displayItems.map((item, index) => {
                    const isSelected = item.path === selectedSessionPath;
                    const delayMs = Math.min(TILE_STAGGER_MAX_INDEX, Math.max(0, index)) * TILE_STAGGER_MS;
                    return (
                      <button
                        key={`${tileAnimationEpoch}:${item.id}`}
                        type="button"
                        className={`session-gallery-tile is-entering${isSelected ? " is-active" : ""}`}
                        style={{ ["--session-gallery-tile-delay" as string]: `${delayMs}ms` }}
                        onClick={() => setSelectedSessionPath(item.path)}
                        onDoubleClick={() => props.onOpenSession(item)}
                        disabled={props.isBusy}
                        title={buildSessionGalleryTileTitle(item)}
                      >
                        <img src={item.previewUrl} alt={`Preview for ${item.path}`} loading="lazy" />
                        <span className="session-gallery-tile-label">{item.tileLabel ?? item.path}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="session-gallery-grid-actions">
              <AppButton
                variant="primary"
                onClick={() => {
                  if (selectedItem !== null) {
                    props.onOpenSession(selectedItem);
                  }
                }}
                disabled={!canOpenSelected}
              >
                Open
              </AppButton>
              <AppButton
                variant="danger"
                onClick={() => {
                  if (selectedItem !== null && selectedItem.sourceKind === "local" && selectedItem.localPath !== undefined) {
                    props.onDeleteSession(selectedItem.localPath);
                  }
                }}
                disabled={!canDeleteSelected}
              >
                Delete
              </AppButton>
              <AppButton onClick={beginRenameSelected} disabled={!canRenameSelected}>
                Rename...
              </AppButton>
            </div>
          </div>
        </div>

        <div className="session-gallery-footer">
          <div className="session-gallery-storage-stats" aria-label="Storage information">
            <div className="session-gallery-storage-stat">
              <span className="session-gallery-storage-label">Snapshot storage</span>
              <span className="session-gallery-storage-value">
                {formatBytes(props.storageInfo.snapshotStorageBytes)}
              </span>
            </div>
            <div className="session-gallery-storage-stat">
              <span className="session-gallery-storage-label">Origin usage / quota</span>
              <span className="session-gallery-storage-value">
                {formatBytes(props.storageInfo.originUsageBytes)} / {formatBytes(props.storageInfo.originQuotaBytes)}
              </span>
            </div>
            <div className="session-gallery-storage-stat">
              <span className="session-gallery-storage-label">Persistent storage</span>
              <div className="session-gallery-storage-value-row">
                <span className="session-gallery-storage-value">
                  {persistentStorageStatusLabel(props.storageInfo.persistentStorageStatus)}
                  {props.storageInfo.persistentStorageStatus !== "enabled" &&
                  props.storageInfo.persistentStorageStatus !== "unavailable" ? (
                    <>
                      {" "}
                      (
                      <button
                        type="button"
                        className="session-gallery-inline-link"
                        onClick={() => void props.onRequestPersistentStorage()}
                        disabled={props.isBusy || props.persistentStorageRequestInProgress}
                      >
                        {props.persistentStorageRequestInProgress ? "Requesting..." : "Request persistence"}
                      </button>
                      )
                    </>
                  ) : null}
                </span>
          </div>
        </div>
        <div
          className="session-gallery-resize-handle"
          role="separator"
          aria-label="Resize session gallery dialog"
          onPointerDown={onStartDialogResize}
          onPointerMove={onDialogResizePointerMove}
          onPointerUp={onDialogResizePointerDone}
          onPointerCancel={onDialogResizePointerDone}
        />
      </div>
        </div>

        {externalAddDialogOpen ? (
          <div className="session-gallery-submodal-backdrop">
            <div
              className="session-gallery-submodal-window"
              role="dialog"
              aria-modal="true"
              aria-labelledby="session-gallery-add-source-title"
            >
              <div className="session-gallery-submodal-header">
                <h4 id="session-gallery-add-source-title">Add External GitHub Folder</h4>
              </div>
              <label className="session-gallery-submodal-field">
                <span className="muted">GitHub folder URL</span>
                <input
                  type="text"
                  className="modal-input"
                  placeholder="https://github.com/owner/repo/tree/branch/folder"
                  value={externalUrlInput}
                  autoFocus
                  disabled={props.isBusy || addExternalInProgress}
                  onChange={(event) => {
                    setExternalUrlInput(event.target.value);
                    if (externalUrlError !== null) {
                      setExternalUrlError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitExternalSource();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      closeExternalAddDialog();
                    }
                  }}
                  spellCheck={false}
                />
              </label>
              {externalUrlError !== null ? <p className="dialog-error session-gallery-external-error">{externalUrlError}</p> : null}
              <div className="session-gallery-submodal-actions">
                <AppButton
                  variant="primary"
                  onClick={() => void submitExternalSource()}
                  disabled={props.isBusy || addExternalInProgress || externalUrlInput.trim().length === 0}
                >
                  {addExternalInProgress ? "Adding..." : "Add"}
                </AppButton>
                <AppButton onClick={closeExternalAddDialog} disabled={addExternalInProgress}>Cancel</AppButton>
              </div>
            </div>
          </div>
        ) : null}

        {zipDropActive ? (
          <div className="session-gallery-drop-overlay" role="presentation" aria-hidden="true">
            <div className="session-gallery-drop-overlay-panel">
              <div className="session-gallery-drop-overlay-title">Drop ZIP to Import</div>
              <div className="session-gallery-drop-overlay-detail">Session Gallery ZIP</div>
            </div>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="session-gallery-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (file !== null) {
              void props.onImportZip(file);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );
}
