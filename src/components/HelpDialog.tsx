import { AppButton } from "./AppButton";

interface HelpDialogProps {
  open: boolean;
  versionLabel: string;
  onClose: () => void;
}

const KEYBOARD_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "W / A / S / D", action: "Move camera (forward / left / back / right, camera-relative)" },
  { keys: "R / C", action: "Move camera down / up (world Y)" },
  { keys: "Q / E", action: "Roll camera left / right" },
  { keys: "G / J", action: "Rotate system around origin left / right (same as Shift+drag, screen horizontal)" },
  { keys: "Y / H", action: "Rotate system around origin up / down (same as Shift+drag, screen vertical)" },
  { keys: "F", action: "Focus depth-of-field at mouse cursor in 3D view" },
  { keys: "Shift", action: "5x smaller movement / rotation steps (modifier)" },
  { keys: "Ctrl", action: "5x larger movement / rotation steps (modifier)" },
  { keys: "1 / 2 / 3 / X", action: "Adjust base camera step size" }
];

const MOUSE_SHORTCUTS: Array<{ gesture: string; action: string }> = [
  { gesture: "Left drag", action: "Orbit view (camera turns around eye)" },
  { gesture: "Shift + Left drag", action: "Rotate system around origin" },
  { gesture: "Right drag", action: "Pan camera" },
  { gesture: "Middle drag", action: "Zoom (FOV)" },
  { gesture: "Mouse wheel", action: "Dolly forward/back" },
  { gesture: "Shift + Mouse wheel", action: "Adjust camera step size" }
];

export function HelpDialog(props: HelpDialogProps): JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div className="modal-window help-modal-window" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
        <div className="help-modal-header">
          <div>
            <h3 id="help-dialog-title">Help</h3>
            <div className="help-version">Fragmentarium Web {props.versionLabel}</div>
          </div>
          <AppButton onClick={props.onClose}>
            Close
          </AppButton>
        </div>

        <div className="help-section">
          <h4>Keyboard Shortcuts</h4>
          <div className="help-shortcut-list">
            {KEYBOARD_SHORTCUTS.map((entry) => (
              <div key={entry.keys} className="help-shortcut-row">
                <span className="help-shortcut-keys">{entry.keys}</span>
                <span className="help-shortcut-action">{entry.action}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="help-section">
          <h4>Mouse Controls</h4>
          <div className="help-shortcut-list">
            {MOUSE_SHORTCUTS.map((entry) => (
              <div key={entry.gesture} className="help-shortcut-row">
                <span className="help-shortcut-keys">{entry.gesture}</span>
                <span className="help-shortcut-action">{entry.action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
