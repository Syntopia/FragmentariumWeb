import { useRef } from "react";

interface ColorPickerButtonProps {
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

function joinClasses(parts: Array<string | undefined | null | false>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}

function parseHexChannel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
  return Number.isFinite(value) ? value : 0;
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function getContrastTextColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) {
    return "#F5F8FF";
  }
  const r = srgbToLinear(parseHexChannel(hex, 1));
  const g = srgbToLinear(parseHexChannel(hex, 3));
  const b = srgbToLinear(parseHexChannel(hex, 5));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.38 ? "#0E121A" : "#F5F8FF";
}

export function ColorPickerButton(props: ColorPickerButtonProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayHex = props.value.toUpperCase();
  const textColor = getContrastTextColor(props.value);
  const textShadowColor = textColor === "#0E121A" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.3)";

  return (
    <div className={joinClasses(["color-picker-button", props.className])}>
      <input
        ref={inputRef}
        className="color-picker-native-input"
        type="color"
        value={props.value}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        className="color-picker-trigger"
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        title={displayHex}
        style={{
          backgroundColor: props.value,
          color: textColor,
          textShadow: `0 1px 0 ${textShadowColor}`
        }}
        onClick={() => inputRef.current?.click()}
      >
        <span className="color-picker-text">{displayHex}</span>
      </button>
    </div>
  );
}
