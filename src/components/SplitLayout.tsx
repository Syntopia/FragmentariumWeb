import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";

interface SplitLayoutProps {
  leftWidth: number;
  rightWidth: number;
  minPaneWidth: number;
  onLeftWidthChange: (next: number) => void;
  onRightWidthChange: (next: number) => void;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function SplitLayout(props: SplitLayoutProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    event.preventDefault();
    const containerWidth = container.getBoundingClientRect().width;
    const startX = event.clientX;
    const startLeft = props.leftWidth;
    const startRight = props.rightWidth;

    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        const maxLeft = containerWidth - props.rightWidth - props.minPaneWidth - 32;
        const next = clamp(startLeft + delta, props.minPaneWidth, maxLeft);
        props.onLeftWidthChange(next);
        return;
      }

      const maxRight = containerWidth - props.leftWidth - props.minPaneWidth - 32;
      const next = clamp(startRight - delta, props.minPaneWidth, maxRight);
      props.onRightWidthChange(next);
    };

    const done = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  };

  return (
    <div className="split-layout" ref={containerRef}>
      <section className="pane pane-left" style={{ width: props.leftWidth }}>
        {props.left}
      </section>
      <div
        className="pane-splitter"
        role="separator"
        aria-label="Resize left pane"
        onPointerDown={(event) => startDrag("left", event)}
      />
      <section className="pane pane-center">{props.center}</section>
      <div
        className="pane-splitter"
        role="separator"
        aria-label="Resize right pane"
        onPointerDown={(event) => startDrag("right", event)}
      />
      <section className="pane pane-right" style={{ width: props.rightWidth }}>
        {props.right}
      </section>
    </div>
  );
}
