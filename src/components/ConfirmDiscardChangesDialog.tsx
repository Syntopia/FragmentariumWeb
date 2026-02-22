import { useEffect, useRef } from "react";
import { AppButton } from "./AppButton";

interface ConfirmDiscardChangesDialogProps {
  open: boolean;
  targetLabel: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDiscardChangesDialog(
  props: ConfirmDiscardChangesDialogProps
): JSX.Element | null {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    confirmButtonRef.current?.focus();
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
      <div className="modal-window" role="dialog" aria-modal="true" aria-labelledby="discard-switch-dialog-title">
        <h3 id="discard-switch-dialog-title">Discard Unsaved Changes</h3>
        <p className="muted">
          Switching systems or sessions will discard current unsaved changes.
        </p>
        <p className="dialog-warning">
          {props.targetLabel !== null
            ? `Discard changes and switch to '${props.targetLabel}'?`
            : "Discard changes and switch to another system/session?"}
        </p>
        <div className="modal-actions">
          <AppButton onClick={props.onCancel}>Cancel</AppButton>
          <AppButton ref={confirmButtonRef} variant="danger" onClick={props.onConfirm}>
            Discard and Switch
          </AppButton>
        </div>
      </div>
    </div>
  );
}
