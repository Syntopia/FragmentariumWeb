import type { PresetTreeNode } from "../core/presets/presetTree";

interface PresetTreeViewProps {
  nodes: PresetTreeNode[];
  activePresetName: string | null;
  onSelect: (presetName: string) => void;
}

export function PresetTreeView(props: PresetTreeViewProps): JSX.Element {
  return (
    <div className="preset-tree" role="tree">
      {props.nodes.map((node) => (
        <PresetNode
          key={node.fullPath}
          node={node}
          activePresetName={props.activePresetName}
          onSelect={props.onSelect}
        />
      ))}
    </div>
  );
}

interface PresetNodeProps {
  node: PresetTreeNode;
  activePresetName: string | null;
  onSelect: (presetName: string) => void;
}

function PresetNode(props: PresetNodeProps): JSX.Element {
  const hasChildren = props.node.children.length > 0;
  const isLeaf = props.node.preset !== null;
  const isActive = props.activePresetName === props.node.fullPath;

  return (
    <div className="preset-node" role="treeitem" aria-expanded={hasChildren ? true : undefined}>
      {isLeaf ? (
        <button
          type="button"
          className={`preset-button ${isActive ? "is-active" : ""}`}
          onClick={() => props.onSelect(props.node.fullPath)}
        >
          {props.node.name}
        </button>
      ) : (
        <div className="preset-folder">{props.node.name}</div>
      )}

      {hasChildren ? (
        <div className="preset-children" role="group">
          {props.node.children.map((child) => (
            <PresetNode
              key={child.fullPath}
              node={child}
              activePresetName={props.activePresetName}
              onSelect={props.onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
