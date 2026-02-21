import { useEffect, useRef } from "react";

interface SaveLocalSystemDialogProps {
  open: boolean;
  pathValue: string;
  errorMessage: string | null;
  isOverwrite: boolean;
  onPathChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function SaveLocalSystemDialog(props: SaveLocalSystemDialogProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onCancel();
        }
      }}
    >
      <div
        className="modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-local-dialog-title"
      >
        <h3 id="save-local-dialog-title">Save to Local Storage</h3>
        <p className="muted">Path supports subfolders, for example `mandelbulb/mikaels`.</p>
        <label className="modal-field">
          <span className="uniform-label">Path</span>
          <input
            ref={inputRef}
            type="text"
            className="modal-input"
            value={props.pathValue}
            onChange={(event) => props.onPathChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                props.onSave();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                props.onCancel();
              }
            }}
          />
        </label>
        {props.errorMessage !== null ? <p className="dialog-error">{props.errorMessage}</p> : null}
        {props.isOverwrite ? <p className="dialog-warning">Existing local system will be overwritten.</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" onClick={props.onSave}>
            {props.isOverwrite ? "Overwrite" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
