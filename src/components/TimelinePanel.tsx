import { useId, useMemo, useRef } from "react";
import type { ExportInterpolationMode } from "../app/exportInterpolation";
import type { SessionTimelineKeyframe } from "../app/timeline";
import type { TimelineGraphLine } from "../app/timelineGraph";
import { AppButton } from "./AppButton";
import { UiIcon } from "./UiIcon";

interface TimelinePanelProps {
  keyframes: SessionTimelineKeyframe[];
  activeKeyId: string;
  playheadT: number;
  interpolation: ExportInterpolationMode;
  graphLines: TimelineGraphLine[];
  isPlaying: boolean;
  playbackDurationSeconds: number;
  onPlaybackDurationChange: (seconds: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onPrevKeyframe: () => void;
  onNextKeyframe: () => void;
  onInterpolationChange: (mode: ExportInterpolationMode) => void;
  onScrubPreview: (t: number) => void;
  onScrubCommit: (t: number) => void;
  onActivateKeyframe: (keyId: string) => void;
  onMoveKeyframe: (keyId: string, t: number) => void;
  onMoveKeyframeEnd: (keyId: string, t: number) => void;
  onAddLeft: () => void;
  onAddRight: () => void;
  onDeleteActive: () => void;
  onFit: () => void;
}

interface TimelinePointerInteraction {
  pointerId: number;
  kind: "scrub" | "drag-key";
  keyId?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function TimelinePanel(props: TimelinePanelProps): JSX.Element {
  const trackInnerRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<TimelinePointerInteraction | null>(null);
  const graphClipId = useId().replaceAll(":", "_");

  const keyframes = useMemo(
    () =>
      [...props.keyframes].sort((a, b) => {
        if (Math.abs(a.t - b.t) > 1e-6) {
          return a.t - b.t;
        }
        return a.id.localeCompare(b.id);
      }),
    [props.keyframes]
  );
  const activeKeyIndex = keyframes.findIndex((entry) => entry.id === props.activeKeyId);
  const canGoPrevKeyframe = activeKeyIndex > 0;
  const canGoNextKeyframe = activeKeyIndex >= 0 && activeKeyIndex < keyframes.length - 1;

  const getTimeFromClientX = (clientX: number): number => {
    const trackInner = trackInnerRef.current;
    if (trackInner === null) {
      return 0;
    }
    const rect = trackInner.getBoundingClientRect();
    if (rect.width <= 1) {
      return 0;
    }
    return clamp01((clientX - rect.left) / rect.width);
  };

  const stopInteraction = (): void => {
    interactionRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const interaction = interactionRef.current;
    if (interaction === null || interaction.pointerId !== event.pointerId) {
      return;
    }
    const t = getTimeFromClientX(event.clientX);
    if (interaction.kind === "scrub") {
      props.onScrubPreview(t);
      return;
    }
    if (interaction.kind === "drag-key" && interaction.keyId !== undefined) {
      props.onMoveKeyframe(interaction.keyId, t);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    const interaction = interactionRef.current;
    if (interaction === null || interaction.pointerId !== event.pointerId) {
      return;
    }
    const t = getTimeFromClientX(event.clientX);
    if (interaction.kind === "scrub") {
      props.onScrubCommit(t);
    } else if (interaction.kind === "drag-key" && interaction.keyId !== undefined) {
      props.onMoveKeyframeEnd(interaction.keyId, t);
    }
    stopInteraction();
  };

  const beginInteraction = (interaction: TimelinePointerInteraction): void => {
    interactionRef.current = interaction;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const clampedT = clamp01(props.playheadT);
  const currentTimeSeconds = clampedT * Math.max(0.1, props.playbackDurationSeconds);
  const GRAPH_MIN_X = 0;
  const GRAPH_MAX_X = 1000;
  const GRAPH_MIN_Y = 0;
  const GRAPH_MAX_Y = 100;
  const GRAPH_WIDTH = GRAPH_MAX_X - GRAPH_MIN_X;
  const GRAPH_PADDING_Y = 2;
  const GRAPH_PLOT_MIN_Y = GRAPH_MIN_Y + GRAPH_PADDING_Y;
  const GRAPH_PLOT_MAX_Y = GRAPH_MAX_Y - GRAPH_PADDING_Y;
  const GRAPH_PLOT_HEIGHT = Math.max(1, GRAPH_PLOT_MAX_Y - GRAPH_PLOT_MIN_Y);

  return (
    <section className="timeline-panel section-block">
      <div className="timeline-toolbar timeline-toolbar-top">
        <div className="timeline-toolbar-group timeline-toolbar-group-left">
          <AppButton
            onClick={props.onPlay}
            disabled={props.isPlaying}
            title="Play timeline from current time"
          >
            <span className="button-content">
              <UiIcon name="play" size={13} />
              <span>Play</span>
            </span>
          </AppButton>
          <AppButton
            onClick={props.onPause}
            disabled={!props.isPlaying}
            title="Pause timeline playback"
          >
            <span className="button-content">
              <UiIcon name="pause" size={13} />
              <span>Pause</span>
            </span>
          </AppButton>
          <AppButton onClick={props.onPrevKeyframe} disabled={!canGoPrevKeyframe} title="Activate previous keyframe">
            <span className="button-content">
              <span aria-hidden="true">&lt;&lt;</span>
            </span>
          </AppButton>
          <AppButton onClick={props.onNextKeyframe} disabled={!canGoNextKeyframe} title="Activate next keyframe">
            <span className="button-content">
              <span aria-hidden="true">&gt;&gt;</span>
            </span>
          </AppButton>
        </div>
        <div className="timeline-toolbar-center">
          <span className="timeline-readout" title="Current timeline time">
            time {currentTimeSeconds.toFixed(2)} s
          </span>
        </div>
        <div className="timeline-toolbar-group timeline-toolbar-group-right">
          <label className="timeline-playback-duration" title="Total playback duration from time 0 to 1">
            <span>Length (s)</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={props.playbackDurationSeconds}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(value)) {
                  return;
                }
                props.onPlaybackDurationChange(Math.max(0.1, value));
              }}
            />
          </label>
          <label className="timeline-interpolation" title="Interpolation used between neighboring keyframes">
            <span>Interpolation</span>
            <select
              value={props.interpolation}
              onChange={(event) => props.onInterpolationChange(event.target.value as ExportInterpolationMode)}
            >
              <option value="linear">Linear</option>
              <option value="ease-in-out">Ease In/Out</option>
              <option value="monotone-cubic">Monotone Cubic</option>
              <option value="catmull-rom">Catmull-Rom</option>
            </select>
          </label>
        </div>
      </div>

      <div
        className="timeline-track"
        title="Drag to scrub timeline preview"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          const t = getTimeFromClientX(event.clientX);
          props.onScrubPreview(t);
          beginInteraction({
            pointerId: event.pointerId,
            kind: "scrub"
          });
        }}
      >
        <div className="timeline-track-inner" ref={trackInnerRef}>
          <div className="timeline-track-line" />
          {props.graphLines.length > 0 ? (
            <svg
              className="timeline-track-graph"
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
              width="100%"
              height="100%"
              aria-hidden="true"
            >
              <defs>
                <clipPath id={graphClipId} clipPathUnits="userSpaceOnUse">
                  <rect
                    x={GRAPH_MIN_X}
                    y={GRAPH_PLOT_MIN_Y}
                    width={GRAPH_WIDTH}
                    height={GRAPH_PLOT_HEIGHT}
                    rx={2}
                    ry={2}
                  />
                </clipPath>
              </defs>
              <g clipPath={`url(#${graphClipId})`}>
                {props.graphLines.map((line, lineIndex) => {
                  const points = line.points
                    .map((point) => {
                      const x = Math.max(GRAPH_MIN_X, Math.min(GRAPH_MAX_X, GRAPH_MIN_X + point.t * GRAPH_WIDTH));
                      const y = Math.max(
                        GRAPH_PLOT_MIN_Y,
                        Math.min(GRAPH_PLOT_MAX_Y, GRAPH_PLOT_MAX_Y - point.value * GRAPH_PLOT_HEIGHT)
                      );
                      return `${x.toFixed(2)},${y.toFixed(2)}`;
                    })
                    .join(" ");
                  const isCameraLine = line.id.startsWith("camera.");
                  const hue = isCameraLine ? 30 : 204 + ((lineIndex % 6) - 3) * 8;
                  const lightness = isCameraLine ? 66 : 62 + (lineIndex % 3) * 4;
                  const alpha = isCameraLine ? 0.3 : 0.26;
                  return (
                    <polyline
                      key={line.id}
                      className="timeline-track-graph-line"
                      points={points}
                      style={{ stroke: `hsla(${hue}, 95%, ${lightness}%, ${alpha})` }}
                    />
                  );
                })}
              </g>
            </svg>
          ) : null}
          {keyframes.length <= 1 ? (
            <div className="timeline-track-overlay-hint">
              Add new keyframe to the left or right to get started
            </div>
          ) : null}
          <div className="timeline-playhead" style={{ left: `${clamp01(props.playheadT) * 100}%` }} />
          {keyframes.map((keyframe) => {
            const isActive = keyframe.id === props.activeKeyId;
            return (
              <button
                key={keyframe.id}
                type="button"
                className={`timeline-keyframe${isActive ? " is-active" : ""}`}
                style={{ left: `${clamp01(keyframe.t) * 100}%` }}
                title={`Keyframe at time ${clamp01(keyframe.t).toFixed(3)}. Click to activate, drag to retime.`}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  props.onActivateKeyframe(keyframe.id);
                  beginInteraction({
                    pointerId: event.pointerId,
                    kind: "drag-key",
                    keyId: keyframe.id
                  });
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onActivateKeyframe(keyframe.id);
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="timeline-toolbar timeline-toolbar-bottom">
        <div className="timeline-toolbar-group timeline-toolbar-group-keyframes">
          <span className="timeline-toolbar-caption">Key frames</span>
          <AppButton onClick={props.onAddLeft} title="Add a new keyframe before the active keyframe">
            <span className="button-content">
              <UiIcon name="add-left" size={13} />
              <span>Add left</span>
            </span>
          </AppButton>
          <AppButton onClick={props.onAddRight} title="Add a new keyframe after the active keyframe">
            <span className="button-content">
              <UiIcon name="add-right" size={13} />
              <span>Add right</span>
            </span>
          </AppButton>
          <AppButton
            onClick={props.onDeleteActive}
            disabled={keyframes.length <= 1}
            title="Delete the active keyframe"
          >
            <span className="button-content">
              <UiIcon name="delete" size={13} />
              <span>Delete</span>
            </span>
          </AppButton>
          <AppButton
            onClick={props.onFit}
            disabled={keyframes.length <= 1}
            title="Evenly distribute keyframes from start to end while preserving order"
          >
            <span className="button-content">
              <UiIcon name="distribute" size={13} />
              <span>Even out keyframes</span>
            </span>
          </AppButton>
        </div>
      </div>
    </section>
  );
}
