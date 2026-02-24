import { useEffect, useRef, useState } from "react";
import type { ExportInterpolationMode, ChangedValueSummary } from "../app/exportInterpolation";
import type { WebCodecsMovieCodec } from "../utils/webcodecsWebmEncoder";
import { AppButton } from "./AppButton";

export interface ExportRenderDialogProgress {
  overallProgress: number;
  currentFrameIndex: number;
  totalFrames: number;
  etaLabel: string;
  stageLabel: string;
}

export interface ExportRenderDialogProps {
  open: boolean;
  canAnimate: boolean;
  mode: "still" | "animation";
  width: number;
  height: number;
  aspectRatioLocked: boolean;
  aspectRatio: number;
  subframes: number;
  frameCount: number;
  presetNames: string[];
  startPresetName: string | null;
  endPresetName: string | null;
  interpolation: ExportInterpolationMode;
  previewFrame: number;
  movieSupported: boolean;
  movieUnavailableReason: string | null;
  movieCodec: WebCodecsMovieCodec;
  movieFps: number;
  movieBitrateMbps: number;
  movieKeyframeInterval: number;
  changedValues: ChangedValueSummary[];
  statusMessage: string | null;
  isExporting: boolean;
  progress: ExportRenderDialogProgress | null;
  onClose: () => void;
  onStartExport: () => void;
  onStartMovieExport: () => void;
  onCancelExport: () => void;
  onModeChange: (mode: "still" | "animation") => void;
  onWidthChange: (value: number) => void;
  onHeightChange: (value: number) => void;
  onAspectRatioLockChange: (locked: boolean) => void;
  onSubframesChange: (value: number) => void;
  onFrameCountChange: (value: number) => void;
  onStartPresetChange: (name: string) => void;
  onEndPresetChange: (name: string) => void;
  onInterpolationChange: (mode: ExportInterpolationMode) => void;
  onPreviewFrameChange: (value: number) => void;
  onMovieCodecChange: (codec: WebCodecsMovieCodec) => void;
  onMovieFpsChange: (value: number) => void;
  onMovieBitrateMbpsChange: (value: number) => void;
  onMovieKeyframeIntervalChange: (value: number) => void;
}

function clampInt(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.round(value));
}

function clampFloat(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
}

export function ExportRenderDialog(props: ExportRenderDialogProps): JSX.Element | null {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  useEffect(() => {
    if (props.open) {
      setDragOffset({ x: 0, y: 0 });
    }
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const animationEnabled = props.mode === "animation" && props.canAnimate;
  const previewFrameMax = Math.max(0, props.frameCount - 1);
  const exportDisabled =
    props.isExporting ||
    props.width <= 0 ||
    props.height <= 0 ||
    props.subframes <= 0 ||
    (animationEnabled && (props.startPresetName === null || props.endPresetName === null));
  const movieExportDisabled = exportDisabled || !animationEnabled;
  const movieConfigInvalid =
    props.movieFps <= 0 || props.movieBitrateMbps <= 0 || props.movieKeyframeInterval <= 0;
  const movieButtonDisabled = movieExportDisabled || !props.movieSupported || movieConfigInvalid;
  const aspectRatioLabel = Number.isFinite(props.aspectRatio) && props.aspectRatio > 0
    ? `${props.aspectRatio.toFixed(3)}:1`
    : "n/a";

  return (
    <div className="modal-backdrop">
      <div
        className="modal-window export-modal-window"
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-render-dialog-title"
      >
        <div className="export-modal-titlebar">
          <div
            className="export-modal-titlebar-drag"
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();
              dragStateRef.current = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startOffsetX: dragOffset.x,
                startOffsetY: dragOffset.y
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragStateRef.current;
              if (drag === null || drag.pointerId !== event.pointerId) {
                return;
              }
              const nextX = drag.startOffsetX + (event.clientX - drag.startClientX);
              const nextY = drag.startOffsetY + (event.clientY - drag.startClientY);
              setDragOffset({ x: Math.round(nextX), y: Math.round(nextY) });
            }}
            onPointerUp={(event) => {
              const drag = dragStateRef.current;
              if (drag !== null && drag.pointerId === event.pointerId) {
                dragStateRef.current = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              const drag = dragStateRef.current;
              if (drag !== null && drag.pointerId === event.pointerId) {
                dragStateRef.current = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            <h3 id="export-render-dialog-title">Export Render</h3>
          </div>
          {!props.isExporting ? (
            <AppButton onClick={props.onClose}>
              Close
            </AppButton>
          ) : null}
        </div>

        <div className="export-mode-row">
          <label className="uniform-bool">
            <span>Still</span>
            <input
              type="radio"
              name="export-mode"
              checked={props.mode === "still"}
              disabled={props.isExporting}
              onChange={() => props.onModeChange("still")}
            />
          </label>
          <label className="uniform-bool">
            <span>Animation</span>
            <input
              type="radio"
              name="export-mode"
              checked={props.mode === "animation"}
              disabled={props.isExporting || !props.canAnimate}
              onChange={() => props.onModeChange("animation")}
            />
          </label>
        </div>

        <div className="export-grid">
          <label className="modal-field">
            <span className="uniform-label">Width</span>
            <input
              type="number"
              min={1}
              className="modal-input"
              value={props.width}
              disabled={props.isExporting}
              onChange={(event) => props.onWidthChange(clampInt(event.target.valueAsNumber, 1))}
            />
          </label>
          <label className="modal-field">
            <span className="uniform-label">Height</span>
            <input
              type="number"
              min={1}
              className="modal-input"
              value={props.height}
              disabled={props.isExporting}
              onChange={(event) => props.onHeightChange(clampInt(event.target.valueAsNumber, 1))}
            />
          </label>
          <label className="modal-field">
            <span className="uniform-label">Aspect</span>
            <div className="uniform-bool export-aspect-lock">
              <span>{props.aspectRatioLocked ? `Locked (${aspectRatioLabel})` : "Unlocked"}</span>
              <input
                type="checkbox"
                checked={props.aspectRatioLocked}
                disabled={props.isExporting}
                onChange={(event) => props.onAspectRatioLockChange(event.target.checked)}
              />
            </div>
          </label>
          <label className="modal-field">
            <span className="uniform-label">Subframes</span>
            <input
              type="number"
              min={1}
              className="modal-input"
              value={props.subframes}
              disabled={props.isExporting}
              onChange={(event) => props.onSubframesChange(clampInt(event.target.valueAsNumber, 1))}
            />
          </label>
          {animationEnabled ? (
            <label className="modal-field">
              <span className="uniform-label">Frames</span>
              <input
                type="number"
                min={1}
                className="modal-input"
                value={props.frameCount}
                disabled={props.isExporting}
                onChange={(event) => props.onFrameCountChange(clampInt(event.target.valueAsNumber, 1))}
              />
            </label>
          ) : null}
        </div>

        {animationEnabled ? (
          <>
            <div className="export-grid">
              <label className="modal-field">
                <span className="uniform-label">Start Preset</span>
                <select
                  className="modal-input"
                  value={props.startPresetName ?? ""}
                  disabled={props.isExporting}
                  onChange={(event) => props.onStartPresetChange(event.target.value)}
                >
                  {props.presetNames.map((name) => (
                    <option key={`export-start-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span className="uniform-label">End Preset</span>
                <select
                  className="modal-input"
                  value={props.endPresetName ?? ""}
                  disabled={props.isExporting}
                  onChange={(event) => props.onEndPresetChange(event.target.value)}
                >
                  {props.presetNames.map((name) => (
                    <option key={`export-end-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span className="uniform-label">Interpolation</span>
                <select
                  className="modal-input"
                  value={props.interpolation}
                  disabled={props.isExporting}
                  onChange={(event) => props.onInterpolationChange(event.target.value as ExportInterpolationMode)}
                >
                  <option value="linear">Linear</option>
                  <option value="ease-in-out">Ease In/Out</option>
                </select>
              </label>
            </div>

            <label className="modal-field">
              <span className="uniform-label">Preview Frame ({props.previewFrame + 1}/{Math.max(1, props.frameCount)})</span>
              <div className="uniform-inputs">
                <input
                  type="range"
                  min={0}
                  max={previewFrameMax}
                  step={1}
                  value={Math.min(previewFrameMax, props.previewFrame)}
                  disabled={props.isExporting || previewFrameMax <= 0}
                  onChange={(event) => props.onPreviewFrameChange(clampInt(event.target.valueAsNumber, 0))}
                />
                <input
                  type="number"
                  min={0}
                  max={previewFrameMax}
                  className="uniform-number"
                  value={Math.min(previewFrameMax, props.previewFrame)}
                  disabled={props.isExporting}
                  onChange={(event) => props.onPreviewFrameChange(clampInt(event.target.valueAsNumber, 0))}
                />
              </div>
            </label>

            <div className="export-changes-panel">
              <div className="section-header-row">
                <h3>Movie (WebCodecs)</h3>
              </div>
              {!props.movieSupported ? (
                <p className="dialog-warning">
                  {props.movieUnavailableReason ?? "WebCodecs movie export is unavailable in this browser."}
                </p>
              ) : (
                <div className="export-grid">
                  <label className="modal-field">
                    <span className="uniform-label">Codec</span>
                    <select
                      className="modal-input"
                      value={props.movieCodec}
                      disabled={props.isExporting}
                      onChange={(event) => props.onMovieCodecChange(event.target.value as WebCodecsMovieCodec)}
                    >
                      <option value="vp9">VP9 (WebM)</option>
                      <option value="vp8">VP8 (WebM)</option>
                    </select>
                  </label>
                  <label className="modal-field">
                    <span className="uniform-label">FPS</span>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      className="modal-input"
                      value={props.movieFps}
                      disabled={props.isExporting}
                      onChange={(event) => props.onMovieFpsChange(clampInt(event.target.valueAsNumber, 1))}
                    />
                  </label>
                  <label className="modal-field">
                    <span className="uniform-label">Bitrate (Mbps)</span>
                    <input
                      type="number"
                      min={0.1}
                      max={200}
                      step={0.1}
                      className="modal-input"
                      value={props.movieBitrateMbps}
                      disabled={props.isExporting}
                      onChange={(event) =>
                        props.onMovieBitrateMbpsChange(clampFloat(event.target.valueAsNumber, 0.1))
                      }
                    />
                  </label>
                  <label className="modal-field">
                    <span className="uniform-label">Keyframe Interval</span>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      className="modal-input"
                      value={props.movieKeyframeInterval}
                      disabled={props.isExporting}
                      onChange={(event) => props.onMovieKeyframeIntervalChange(clampInt(event.target.valueAsNumber, 1))}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="export-changes-panel">
              <div className="section-header-row">
                <h3>Changing Values ({props.changedValues.length})</h3>
              </div>
              {props.changedValues.length === 0 ? (
                <p className="muted">Selected presets produce no changes.</p>
              ) : (
                <div className="export-changes-list">
                  {props.changedValues.map((entry) => (
                    <div key={`${entry.category}:${entry.name}`} className="export-change-row">
                      <span className="export-change-name">{entry.name}</span>
                      <span className="export-change-values">
                        {entry.from} → {entry.to}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}

        {props.statusMessage !== null ? <p className="muted">{props.statusMessage}</p> : null}

        {props.isExporting && props.progress !== null ? (
          <div className="export-progress-panel">
            <div className="export-progress-row">
              <span>{props.progress.stageLabel}</span>
              {props.progress.totalFrames > 1 ? (
                <span>
                  Frame {Math.min(props.progress.currentFrameIndex + 1, props.progress.totalFrames)} / {props.progress.totalFrames}
                </span>
              ) : (
                <span>Still</span>
              )}
            </div>
            <div className="export-progress-bar" aria-hidden="true">
              <div
                className="export-progress-fill"
                style={{ width: `${Math.round(Math.max(0, Math.min(1, props.progress.overallProgress)) * 100)}%` }}
              />
            </div>
            <div className="export-progress-row">
              <span>{Math.round(Math.max(0, Math.min(1, props.progress.overallProgress)) * 100)}%</span>
              <span>ETA {props.progress.etaLabel}</span>
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          {!props.isExporting ? (
            <>
              <AppButton onClick={props.onClose}>
                Cancel
              </AppButton>
              {animationEnabled ? (
                <AppButton onClick={props.onStartMovieExport} disabled={movieButtonDisabled}>
                  Export Movie...
                </AppButton>
              ) : null}
              <AppButton variant="primary" onClick={props.onStartExport} disabled={exportDisabled}>
                Export PNG{animationEnabled ? " ZIP" : ""}
              </AppButton>
            </>
          ) : (
            <AppButton variant="danger" onClick={props.onCancelExport}>
              Cancel Export
            </AppButton>
          )}
        </div>
      </div>
    </div>
  );
}
