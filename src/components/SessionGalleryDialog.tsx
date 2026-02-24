import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { AppButton } from "./AppButton";

export interface SessionGalleryItem {
  path: string;
  previewUrl: string;
  updatedAtMs: number;
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
  storageInfo: SessionGalleryStorageInfo;
  isBusy: boolean;
  persistentStorageRequestInProgress: boolean;
  onClose: () => void;
  onOpenSession: (path: string) => void;
  onDeleteSession: (path: string) => void;
  onRenameSession: (fromPath: string, toPath: string) => Promise<void> | void;
  onRequestPersistentStorage: () => Promise<void> | void;
  onExportAll: () => void;
  onImportZip: (file: File) => Promise<void> | void;
}

interface GalleryFolderNode {
  id: string;
  name: string;
  path: string;
  children: GalleryFolderNode[];
  itemCount: number;
}

const DEFAULT_THUMB_SIZE = 184;
const MIN_THUMB_SIZE = 96;
const MAX_THUMB_SIZE = 320;
const TILE_STAGGER_MS = 25;
const TILE_STAGGER_MAX_INDEX = 40;

function buildFolderTree(items: SessionGalleryItem[]): GalleryFolderNode {
  const root: GalleryFolderNode = {
    id: "root",
    name: "All Sessions",
    path: "",
    children: [],
    itemCount: items.length
  };

  const childMap = new Map<string, GalleryFolderNode>();
  childMap.set("", root);

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
          itemCount: 0
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
  }

  const sortNodes = (node: GalleryFolderNode): void => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) {
      sortNodes(child);
    }
  };
  sortNodes(root);
  return root;
}

function pathBelongsToFolder(itemPath: string, folderPath: string): boolean {
  if (folderPath.length === 0) {
    return true;
  }
  return itemPath === folderPath || itemPath.startsWith(`${folderPath}/`);
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

export function SessionGalleryDialog(props: SessionGalleryDialogProps): JSX.Element | null {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipDropDepthRef = useRef(0);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>("");
  const [selectedSessionPath, setSelectedSessionPath] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [thumbSizePx, setThumbSizePx] = useState(DEFAULT_THUMB_SIZE);
  const [tileAnimationEpoch, setTileAnimationEpoch] = useState(0);
  const [renameSourcePath, setRenameSourcePath] = useState<string | null>(null);
  const [renameDraftPath, setRenameDraftPath] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameInProgress, setRenameInProgress] = useState(false);
  const [zipDropActive, setZipDropActive] = useState(false);

  const sortedItems = useMemo(
    () => [...props.items].sort((a, b) => a.path.localeCompare(b.path)),
    [props.items]
  );
  const folderTree = useMemo(() => buildFolderTree(sortedItems), [sortedItems]);
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
          return sortedItems.some((item) => pathBelongsToFolder(item.path, path));
        });
      return folderStillExists ? prev : "";
    });
    setSelectedSessionPath((prev) => (prev !== null && sortedItems.some((item) => item.path === prev) ? prev : sortedItems[0]?.path ?? null));
  }, [props.open, sortedItems]);

  useEffect(() => {
    if (selectedSessionPath === null) {
      return;
    }
    if (!pathBelongsToFolder(selectedSessionPath, selectedFolderPath)) {
      setSelectedSessionPath(filteredItems[0]?.path ?? null);
    }
  }, [filteredItems, selectedFolderPath, selectedSessionPath]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setTileAnimationEpoch((prev) => prev + 1);
  }, [filteredItems.length, nameFilter, props.open, selectedFolderPath]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setRenameSourcePath(null);
    setRenameDraftPath(null);
    setRenameError(null);
    setRenameInProgress(false);
    setZipDropActive(false);
    zipDropDepthRef.current = 0;
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const renderFolderNode = (node: GalleryFolderNode, depth: number): JSX.Element => {
    const isSelected = node.path === selectedFolderPath;
    return (
      <div key={node.id} className="session-gallery-folder-node">
        <button
          type="button"
          className={`session-gallery-folder-button${isSelected ? " is-active" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => setSelectedFolderPath(node.path)}
        >
          <span className="session-gallery-folder-name">{node.name}</span>
          <span className="session-gallery-folder-count">{node.itemCount}</span>
        </button>
        {node.children.map((child) => renderFolderNode(child, depth + 1))}
      </div>
    );
  };

  const canOpenSelected = selectedItem !== null && !props.isBusy;
  const canDeleteSelected = selectedItem !== null && !props.isBusy;
  const canRenameSelected = selectedItem !== null && !props.isBusy && !renameInProgress;
  const canExportAll = props.items.length > 0 && !props.isBusy;
  const renameEditorOpen = renameSourcePath !== null && renameDraftPath !== null;

  const beginRenameSelected = (): void => {
    if (selectedItem === null || props.isBusy) {
      return;
    }
    setRenameSourcePath(selectedItem.path);
    setRenameDraftPath(selectedItem.path);
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
      setSelectedSessionPath(renameDraftPath);
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

  return (
    <div
      className="modal-backdrop"
      onDragEnter={onZipDropDragEnter}
      onDragOver={onZipDropDragOver}
      onDragLeave={onZipDropDragLeave}
      onDrop={onZipDrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.isBusy) {
          props.onClose();
        }
      }}
    >
      <div className="modal-window session-gallery-modal-window" role="dialog" aria-modal="true" aria-labelledby="session-gallery-title">
        <div className="session-gallery-header">
          <div>
            <h3 id="session-gallery-title">Session Gallery</h3>
            <p className="muted">
              Local sessions are stored as preview PNGs with embedded session data.
            </p>
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
          <div className="session-gallery-toolbar-left">
            <AppButton
              variant="primary"
              onClick={() => {
                if (selectedItem !== null) {
                  props.onOpenSession(selectedItem.path);
                }
              }}
              disabled={!canOpenSelected}
            >
              Open
            </AppButton>
            <AppButton
              variant="danger"
              onClick={() => {
                if (selectedItem !== null) {
                  props.onDeleteSession(selectedItem.path);
                }
              }}
              disabled={!canDeleteSelected}
            >
              Delete
            </AppButton>
            <AppButton onClick={beginRenameSelected} disabled={!canRenameSelected}>
              Rename...
            </AppButton>
            {selectedItem !== null ? <span className="session-gallery-selection">{selectedItem.path}</span> : null}
          </div>
          <div className="session-gallery-toolbar-right">
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

        <div className="session-gallery-layout">
          <div className="session-gallery-sidebar">
            {renderFolderNode(folderTree, 0)}
          </div>
          <div className="session-gallery-grid-panel">
            {filteredItems.length === 0 ? (
              <div className="session-gallery-empty muted">No sessions in this folder.</div>
            ) : (
              <div
                className="session-gallery-grid"
                style={{ ["--session-gallery-thumb-size" as string]: `${thumbSizePx}px` }}
              >
                {filteredItems.map((item, index) => {
                  const isSelected = item.path === selectedSessionPath;
                  const delayMs = Math.min(TILE_STAGGER_MAX_INDEX, Math.max(0, index)) * TILE_STAGGER_MS;
                  return (
                    <button
                      key={`${tileAnimationEpoch}:${item.path}`}
                      type="button"
                      className={`session-gallery-tile is-entering${isSelected ? " is-active" : ""}`}
                      style={{ ["--session-gallery-tile-delay" as string]: `${delayMs}ms` }}
                      onClick={() => setSelectedSessionPath(item.path)}
                      onDoubleClick={() => props.onOpenSession(item.path)}
                      disabled={props.isBusy}
                      title={item.path}
                    >
                      <img src={item.previewUrl} alt={`Preview for ${item.path}`} loading="lazy" />
                      <span className="session-gallery-tile-label">{item.path}</span>
                    </button>
                  );
                })}
              </div>
            )}
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
                </span>
                <div className="session-gallery-storage-actions">
                  <AppButton
                    onClick={() => void props.onRequestPersistentStorage()}
                    disabled={
                      props.isBusy ||
                      props.persistentStorageRequestInProgress ||
                      props.storageInfo.persistentStorageStatus === "unavailable"
                    }
                  >
                    {props.persistentStorageRequestInProgress ? "Requesting..." : "Request Persistence"}
                  </AppButton>
                </div>
              </div>
            </div>
          </div>
        </div>

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
