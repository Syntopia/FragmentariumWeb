import { useId, useState, type ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  growWhenOpen?: boolean;
}

export function CollapsibleSection(props: CollapsibleSectionProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(props.defaultOpen ?? true);
  const contentId = useId();

  const className = [
    "section-block",
    "collapsible-section",
    props.className ?? "",
    props.growWhenOpen === true && isOpen ? "grow" : ""
  ]
    .filter((entry) => entry.length > 0)
    .join(" ");

  return (
    <section className={className}>
      <div className="collapsible-header">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span className={`collapsible-chevron ${isOpen ? "is-open" : ""}`} aria-hidden="true">
            ▸
          </span>
          <span className="collapsible-title">{props.title}</span>
        </button>
      </div>
      <div id={contentId} className="collapsible-content" hidden={!isOpen}>
        {props.children}
      </div>
    </section>
  );
}
