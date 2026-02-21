import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";

interface VerticalSplitLayoutProps {
  topHeight: number;
  minTopHeight: number;
  minBottomHeight: number;
  onTopHeightChange: (next: number) => void;
  top: ReactNode;
  bottom: ReactNode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function VerticalSplitLayout(props: VerticalSplitLayoutProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    event.preventDefault();
    const containerHeight = container.getBoundingClientRect().height;
    const startY = event.clientY;
    const startTop = props.topHeight;

    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientY - startY;
      const maxTop = containerHeight - props.minBottomHeight - 8;
      const next = clamp(startTop + delta, props.minTopHeight, maxTop);
      props.onTopHeightChange(next);
    };

    const done = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  };

  return (
    <div className="vertical-split-layout" ref={containerRef}>
      <div className="vertical-split-top" style={{ height: props.topHeight }}>
        {props.top}
      </div>
      <div
        className="vertical-splitter"
        role="separator"
        aria-label="Resize systems and definition sections"
        onPointerDown={startDrag}
      />
      <div className="vertical-split-bottom">{props.bottom}</div>
    </div>
  );
}
