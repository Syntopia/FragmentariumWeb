interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
  title?: string;
}

export function ToggleSwitch(props: ToggleSwitchProps): JSX.Element {
  const wrapperClassName = [
    "toggle-switch",
    props.className ?? "",
    props.checked ? "is-checked" : "",
    props.disabled ? "is-disabled" : ""
  ]
    .filter((value) => value.length > 0)
    .join(" ");

  return (
    <label className={wrapperClassName} title={props.title}>
      <input
        className="toggle-switch-input"
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="toggle-switch-track" aria-hidden="true">
        <span className="toggle-switch-thumb" />
      </span>
      <span className="toggle-switch-state" aria-hidden="true">
        {props.checked ? (props.onLabel ?? "On") : (props.offLabel ?? "Off")}
      </span>
    </label>
  );
}
