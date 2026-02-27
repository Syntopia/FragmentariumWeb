import { useId, useMemo, useRef } from "react";
import { normalizeDirectionArray } from "../utils/direction";

interface DirectionTrackballControlProps {
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  ariaLabel: string;
  className?: string;
}

interface PointerDragState {
  pointerId: number;
  startTrackball: [number, number, number];
  startDirection: [number, number, number];
}

const TRACKBALL_SIZE = 88;
const TRACKBALL_CENTER = TRACKBALL_SIZE / 2;
const TRACKBALL_RADIUS = 34;
const TRACKBALL_FLAT_RADIUS = 0.9;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function normalize3(value: readonly number[]): [number, number, number] {
  return normalizeDirectionArray(value, "Direction control vector");
}

function mapPointerToTrackball(
  clientX: number,
  clientY: number,
  element: HTMLElement
): [number, number, number] {
  const rect = element.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const normalizedX = clamp((localX - rect.width * 0.5) / (rect.width * 0.5), -1.2, 1.2);
  const normalizedY = clamp((rect.height * 0.5 - localY) / (rect.height * 0.5), -1.2, 1.2);

  const radialSq = normalizedX * normalizedX + normalizedY * normalizedY;
  if (radialSq <= TRACKBALL_FLAT_RADIUS * TRACKBALL_FLAT_RADIUS) {
    const z = Math.sqrt(Math.max(0, 1 - radialSq));
    return normalize3([normalizedX, normalizedY, z]);
  }

  const radial = Math.sqrt(radialSq);
  return normalize3([normalizedX / radial, normalizedY / radial, 0]);
}

function rotateAroundAxis(
  vector: readonly number[],
  axis: readonly number[],
  radians: number
): [number, number, number] {
  const cosA = Math.cos(radians);
  const sinA = Math.sin(radians);
  const kDotV = dot3(axis, vector);
  const cross = cross3(axis, vector);
  return [
    vector[0] * cosA + cross[0] * sinA + axis[0] * kDotV * (1 - cosA),
    vector[1] * cosA + cross[1] * sinA + axis[1] * kDotV * (1 - cosA),
    vector[2] * cosA + cross[2] * sinA + axis[2] * kDotV * (1 - cosA)
  ];
}

function perpendicularAxis(vector: readonly number[]): [number, number, number] {
  const candidate = Math.abs(vector[0]) < 0.75 ? [1, 0, 0] : [0, 1, 0];
  return normalize3(cross3(vector, candidate));
}

function rotateByTrackballArc(
  direction: readonly number[],
  from: readonly number[],
  to: readonly number[]
): [number, number, number] {
  const fromN = normalize3(from);
  const toN = normalize3(to);
  const dot = clamp(dot3(fromN, toN), -1, 1);
  if (dot >= 0.999999) {
    return normalize3(direction);
  }

  if (dot <= -0.999999) {
    const axis180 = perpendicularAxis(fromN);
    return normalize3(rotateAroundAxis(direction, axis180, Math.PI));
  }

  const axis = normalize3(cross3(fromN, toN));
  const angle = Math.acos(dot);
  return normalize3(rotateAroundAxis(direction, axis, angle));
}

export function DirectionTrackballControl(props: DirectionTrackballControlProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<PointerDragState | null>(null);
  const rawId = useId();
  const arrowMarkerId = useMemo(() => `direction-trackball-arrow-${rawId.replaceAll(":", "")}`, [rawId]);
  const direction = useMemo(
    () => normalizeDirectionArray(props.value, `Direction '${props.ariaLabel}'`),
    [props.ariaLabel, props.value]
  );
  const tipX = TRACKBALL_CENTER + direction[0] * TRACKBALL_RADIUS;
  const tipY = TRACKBALL_CENTER - direction[1] * TRACKBALL_RADIUS;
  const tipHidden = direction[2] < 0;

  const className = ["direction-trackball", props.className ?? ""].filter((entry) => entry.length > 0).join(" ");

  return (
    <div
      ref={rootRef}
      className={className}
      aria-label={props.ariaLabel}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const host = rootRef.current;
        if (host === null) {
          return;
        }
        const startTrackball = mapPointerToTrackball(event.clientX, event.clientY, host);
        const startDirection = normalizeDirectionArray(props.value, `Direction '${props.ariaLabel}'`);
        dragStateRef.current = {
          pointerId: event.pointerId,
          startTrackball,
          startDirection
        };
        host.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const host = rootRef.current;
        const drag = dragStateRef.current;
        if (host === null || drag === null || drag.pointerId !== event.pointerId) {
          return;
        }
        const pointerTrackball = mapPointerToTrackball(event.clientX, event.clientY, host);
        const rotated = rotateByTrackballArc(drag.startDirection, drag.startTrackball, pointerTrackball);
        props.onChange(rotated);
      }}
      onPointerUp={(event) => {
        const host = rootRef.current;
        const drag = dragStateRef.current;
        if (host !== null && drag !== null && drag.pointerId === event.pointerId) {
          dragStateRef.current = null;
          host.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        const host = rootRef.current;
        const drag = dragStateRef.current;
        if (host !== null && drag !== null && drag.pointerId === event.pointerId) {
          dragStateRef.current = null;
          host.releasePointerCapture(event.pointerId);
        }
      }}
    >
      <svg
        className="direction-trackball-svg"
        viewBox={`0 0 ${TRACKBALL_SIZE} ${TRACKBALL_SIZE}`}
        width={TRACKBALL_SIZE}
        height={TRACKBALL_SIZE}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={arrowMarkerId}
            markerWidth="6"
            markerHeight="6"
            refX="5.2"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,3 L0,6 Z" className={`direction-trackball-arrow-head ${tipHidden ? "is-hidden" : ""}`} />
          </marker>
        </defs>
        <circle
          className="direction-trackball-sphere"
          cx={TRACKBALL_CENTER}
          cy={TRACKBALL_CENTER}
          r={TRACKBALL_RADIUS}
        />
        <ellipse
          className="direction-trackball-great-circle"
          cx={TRACKBALL_CENTER}
          cy={TRACKBALL_CENTER}
          rx={TRACKBALL_RADIUS * 0.92}
          ry={TRACKBALL_RADIUS * 0.4}
        />
        <line
          className={`direction-trackball-arrow ${tipHidden ? "is-hidden" : ""}`}
          x1={TRACKBALL_CENTER}
          y1={TRACKBALL_CENTER}
          x2={tipX}
          y2={tipY}
          markerEnd={`url(#${arrowMarkerId})`}
        />
        <circle className="direction-trackball-origin" cx={TRACKBALL_CENTER} cy={TRACKBALL_CENTER} r={2.2} />
        <circle className={`direction-trackball-tip ${tipHidden ? "is-hidden" : ""}`} cx={tipX} cy={tipY} r={3.2} />
      </svg>
    </div>
  );
}
