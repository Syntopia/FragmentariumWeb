import { useEffect } from "react";

import { AppButton } from "./AppButton";
import { SystemsTreeView, type SystemsTreeNode } from "./SystemsTreeView";

interface LegacyFragmentariumImportDialogProps {
  open: boolean;
  nodes: SystemsTreeNode[];
  activeEntryKey: string;
  onSelect: (entryKey: string) => void;
  onDeleteLocal: (localPath: string) => void;
  onClose: () => void;
  localPreviewUrlByPath?: Record<string, string>;
}

export function LegacyFragmentariumImportDialog(
  props: LegacyFragmentariumImportDialogProps
): JSX.Element | null {
  useEffect(() => {
    if (!props.open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      props.onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal-window legacy-import-modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-fragmentarium-import-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-header-row">
          <h3 id="legacy-fragmentarium-import-dialog-title">Legacy Fragmentarium Import</h3>
          <AppButton onClick={props.onClose}>Close</AppButton>
        </div>
        <p className="muted">Select a built-in Fragmentarium fragment to load into the editor.</p>
        <div className="legacy-import-tree-shell">
          <SystemsTreeView
            nodes={props.nodes}
            activeEntryKey={props.activeEntryKey}
            onSelect={props.onSelect}
            onDeleteLocal={props.onDeleteLocal}
            localPreviewUrlByPath={props.localPreviewUrlByPath}
          />
        </div>
      </div>
    </div>
  );
}
