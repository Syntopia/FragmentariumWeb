import { useEffect, useRef } from "react";
import { AppButton } from "./AppButton";

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
    <div className="modal-backdrop">
      <div
        className="modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-local-dialog-title"
      >
        <h3 id="delete-local-dialog-title">Delete Session</h3>
        <p className="muted">This action cannot be undone.</p>
        <p className="dialog-warning">Delete session `{props.localPath}`?</p>
        <div className="modal-actions">
          <AppButton onClick={props.onCancel}>
            Cancel
          </AppButton>
          <AppButton
            ref={deleteButtonRef}
            variant="danger"
            onClick={props.onConfirm}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onCancel();
              }
            }}
          >
            Delete
          </AppButton>
        </div>
      </div>
    </div>
  );
}
