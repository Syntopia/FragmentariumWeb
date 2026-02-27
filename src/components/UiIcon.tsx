import type { SVGProps } from "react";

export type UiIconName =
  | "play"
  | "save"
  | "refresh"
  | "help"
  | "export"
  | "gallery"
  | "session"
  | "copy"
  | "paste"
  | "reset"
  | "insert"
  | "download"
  | "trace"
  | "render"
  | "post"
  | "uniform"
  | "search"
  | "import"
  | "pause"
  | "rewind"
  | "add-left"
  | "add-right"
  | "delete"
  | "distribute";

interface UiIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: UiIconName;
  size?: number;
}

function pathForIcon(name: UiIconName): string {
  switch (name) {
    case "play":
      return "M8 6.8L17.4 12 8 17.2V6.8Z";
    case "save":
      return "M5 4H16L19 7V20H5V4ZM8 4V9H15V4M8 20V14H16V20";
    case "refresh":
      return "M18.2 7.6A8 8 0 1 0 20 12M18.2 7.6V4.8M18.2 7.6H15.4";
    case "help":
      return "M12 18.2A1.2 1.2 0 1 0 12 20.6A1.2 1.2 0 1 0 12 18.2M8.8 9.2A3.2 3.2 0 1 1 14.8 11.1C13.7 11.8 13 12.4 13 14";
    case "export":
      return "M12 4V15M7.5 8.5L12 4L16.5 8.5M5 14V20H19V14";
    case "gallery":
      return "M4.8 5.2H19.2V18.8H4.8V5.2ZM8 14L10.8 10.8L13.2 13.2L15.6 10.8L19.2 14.6";
    case "session":
      return "M4.8 6H9L11 8H19.2V18.8H4.8V6Z";
    case "copy":
      return "M9 9H19V19H9V9ZM5 5H15V7H7V15H5V5Z";
    case "paste":
      return "M9 5H15V7H18V20H6V7H9V5ZM10 12H14M10 15H14";
    case "reset":
      return "M6 7V4.8M6 7H8.2M6 7A8 8 0 1 1 4 12";
    case "insert":
      return "M12 5V19M5 12H19";
    case "download":
      return "M12 5V15M7.5 10.5L12 15L16.5 10.5M5 18.2H19";
    case "trace":
      return "M5.5 18.5L9.8 5.5L14.2 18.5L16.2 12H19";
    case "render":
      return "M5 8H19M5 12H19M5 16H15";
    case "post":
      return "M5 15A7 7 0 1 0 12 5A5 5 0 1 1 5 15Z";
    case "uniform":
      return "M12 4L19 8V16L12 20L5 16V8L12 4Z";
    case "search":
      return "M10.5 5.5A5 5 0 1 1 10.5 15.5A5 5 0 1 1 10.5 5.5M14.2 14.2L19 19";
    case "import":
      return "M12 19V8M7.5 12.5L12 8L16.5 12.5M5 5.8H19";
    case "pause":
      return "M8.5 6H11V18H8.5V6M13 6H15.5V18H13V6";
    case "rewind":
      return "M18.5 6.5L11.5 12L18.5 17.5V6.5M11.5 6.5L4.5 12L11.5 17.5V6.5";
    case "add-left":
      return "M20 12H9M12 8.5L8 12L12 15.5M4 8V16M1 12H7";
    case "add-right":
      return "M4 12H15M12 8.5L16 12L12 15.5M20 8V16M17 12H23";
    case "delete":
      return "M8 7H16M10 7V5H14V7M7 7L8 19H16L17 7M10 10V16M14 10V16";
    case "distribute":
      return "M4 11A1 1 0 1 0 4 13A1 1 0 1 0 4 11M12 11A1 1 0 1 0 12 13A1 1 0 1 0 12 11M20 11A1 1 0 1 0 20 13A1 1 0 1 0 20 11M5.5 12H10.5M13.5 12H18.5M9.2 10.7L10.5 12L9.2 13.3M14.8 10.7L13.5 12L14.8 13.3";
  }
}

export function UiIcon({ name, size = 14, className, ...rest }: UiIconProps): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={pathForIcon(name)} />
    </svg>
  );
}
