import { useEffect, useMemo, useRef, useState } from "react";

export interface SystemsTreeFolderNode {
  type: "folder";
  id: string;
  name: string;
  children: SystemsTreeNode[];
}

export interface SystemsTreeLeafNode {
  type: "leaf";
  id: string;
  name: string;
  entryKey: string;
  localPath?: string;
}

export type SystemsTreeNode = SystemsTreeFolderNode | SystemsTreeLeafNode;

interface SystemsTreeViewProps {
  nodes: SystemsTreeNode[];
  activeEntryKey: string;
  onSelect: (entryKey: string) => void;
  onDeleteLocal: (localPath: string) => void;
}

function collectFolderIds(nodes: SystemsTreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "folder") {
      out.add(node.id);
      collectFolderIds(node.children, out);
    }
  }
}

export function SystemsTreeView(props: SystemsTreeViewProps): JSX.Element {
  const initialOpenFolders = useMemo(() => {
    const ids = new Set<string>();
    collectFolderIds(props.nodes, ids);
    return ids;
  }, [props.nodes]);

  const [openFolders, setOpenFolders] = useState<Set<string>>(initialOpenFolders);
  const knownFolderIdsRef = useRef<Set<string>>(initialOpenFolders);

  useEffect(() => {
    setOpenFolders((prev) => {
      const next = new Set<string>();
      for (const id of initialOpenFolders) {
        if (prev.has(id) || !knownFolderIdsRef.current.has(id)) {
          next.add(id);
        }
      }
      knownFolderIdsRef.current = new Set(initialOpenFolders);
      return next;
    });
  }, [initialOpenFolders]);

  const toggleFolder = (id: string): void => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderNode = (node: SystemsTreeNode, depth: number): JSX.Element => {
    if (node.type === "folder") {
      const isOpen = openFolders.has(node.id);
      return (
        <div key={node.id} className="systems-tree-node">
          <button
            type="button"
            className="systems-tree-folder"
            style={{ paddingLeft: `${depth * 14 + 4}px` }}
            onClick={() => toggleFolder(node.id)}
            aria-expanded={isOpen}
          >
            <span className={`systems-tree-chevron ${isOpen ? "is-open" : ""}`} aria-hidden="true">
              ▸
            </span>
            <span>{node.name}</span>
          </button>
          {isOpen ? node.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }

    const isActive = props.activeEntryKey === node.entryKey;
    const hasDelete = node.localPath !== undefined;
    return (
      <div key={node.id} className="systems-tree-node">
        <div className="systems-tree-leaf-row" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
          <button
            type="button"
            className={`systems-tree-leaf ${isActive ? "is-active" : ""}`}
            onClick={() => props.onSelect(node.entryKey)}
          >
            {node.name}
          </button>
          {hasDelete ? (
            <button
              type="button"
              className="systems-tree-delete"
              onClick={(event) => {
                event.stopPropagation();
                props.onDeleteLocal(node.localPath as string);
              }}
              aria-label={`Delete ${node.name}`}
              title="Delete session"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return <div className="systems-tree">{props.nodes.map((node) => renderNode(node, 0))}</div>;
}
