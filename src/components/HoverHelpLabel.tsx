import type { ReactNode } from "react";

interface HoverHelpLabelProps {
  children: ReactNode;
  helpText: string;
}

export function HoverHelpLabel(props: HoverHelpLabelProps): JSX.Element {
  return (
    <span className="option-help-trigger">
      <span className="option-help-text">{props.children}</span>
      <span className="option-help-popup" role="tooltip">
        {props.helpText}
      </span>
    </span>
  );
}
