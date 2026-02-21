import { useEffect, useRef } from "react";

interface ConfirmDeleteLocalSystemDialogProps {
  open: boolean;
  localPath: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteLocalSystemDialog(
  props: ConfirmDeleteLocalSystemDialogProps
): JSX.Element | null {
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    deleteButtonRef.current?.focus();
  }, [props.open]);

  if (!props.open || props.localPath === null) {
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
        aria-labelledby="delete-local-dialog-title"
      >
        <h3 id="delete-local-dialog-title">Delete Local System</h3>
        <p className="muted">This action cannot be undone.</p>
        <p className="dialog-warning">Delete `{props.localPath}` from local storage?</p>
        <div className="modal-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            className="button-danger"
            onClick={props.onConfirm}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onCancel();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
