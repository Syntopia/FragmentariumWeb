import { useEffect, useRef, useState } from "react";
import type { WebCodecsMovieCodec } from "../utils/webcodecsWebmEncoder";
import { AppButton } from "./AppButton";
import { ToggleSwitch } from "./ToggleSwitch";

export interface ExportRenderDialogProgress {
  overallProgress: number;
  currentFrameIndex: number;
  totalFrames: number;
  etaLabel: string;
  stageLabel: string;
}

export type ExportAnimationFormat = "movie" | "png-zip";
export type ExportSizePresetId = "viewport" | "hd" | "4k" | "square";
export type ExportQualityPresetId = "draft" | "balanced" | "final";

export interface ExportRenderDialogProps {
  open: boolean;
  canAnimate: boolean;
  timelineKeyframeCount: number;
  mode: "still" | "animation";
  width: number;
  height: number;
  aspectRatioLocked: boolean;
  aspectRatio: number;
  subframes: number;
  animationDurationSeconds: number;
  animationFormat: ExportAnimationFormat;
  movieSupported: boolean;
  movieUnavailableReason: string | null;
  movieCodec: WebCodecsMovieCodec;
  movieFps: number;
  movieBitrateMbps: number;
  movieKeyframeInterval: number;
  statusMessage: string | null;
  isExporting: boolean;
  progress: ExportRenderDialogProgress | null;
  onClose: () => void;
  onStartExport: () => void;
  onStartMovieExport: () => void;
  onCancelExport: () => void;
  onWidthChange: (value: number) => void;
  onHeightChange: (value: number) => void;
  onAspectRatioLockChange: (locked: boolean) => void;
  onSubframesChange: (value: number) => void;
  onAnimationDurationSecondsChange: (value: number) => void;
  onAnimationFormatChange: (format: ExportAnimationFormat) => void;
  onMovieCodecChange: (codec: WebCodecsMovieCodec) => void;
  onMovieFpsChange: (value: number) => void;
  onMovieBitrateMbpsChange: (value: number) => void;
  onMovieKeyframeIntervalChange: (value: number) => void;
  onApplySizePreset: (preset: ExportSizePresetId) => void;
  onApplyQualityPreset: (preset: ExportQualityPresetId) => void;
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

function formatDecimalRatioLabel(ratio: number): string {
  const fixed = ratio.toFixed(3).replace(/\.?0+$/, "");
  return `${fixed}:1`;
}

function formatAspectRatioLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "n/a";
  }

  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= 128; denominator += 1) {
    const numerator = Math.max(1, Math.round(ratio * denominator));
    const candidate = numerator / denominator;
    const error = Math.abs(candidate - ratio);
    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
      if (error <= 1.0e-10) {
        break;
      }
    }
  }

  const relativeError = bestError / Math.max(ratio, 1.0e-6);
  if (relativeError <= 1.0e-4) {
    if (bestDenominator === 1) {
      return `${bestNumerator}:1`;
    }
    if (bestDenominator === 10 || bestDenominator === 100 || bestDenominator === 1000) {
      return formatDecimalRatioLabel(bestNumerator / bestDenominator);
    }
    return `${bestNumerator}:${bestDenominator}`;
  }

  return formatDecimalRatioLabel(ratio);
}

function formatDurationLabel(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const remaining = clamped - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(1).padStart(4, "0")}`;
}

function formatBytes(value: number): string {
  const bytes = Math.max(0, value);
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function estimateStillPngBytes(width: number, height: number): number {
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels * 0.85;
}

function estimateAnimationZipBytes(width: number, height: number, frameCount: number): number {
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels * Math.max(1, frameCount) * 0.55;
}

function estimateMovieBytes(durationSeconds: number, bitrateMbps: number): number {
  return Math.max(0.1, durationSeconds) * Math.max(0.1, bitrateMbps) * 1_000_000 / 8;
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

  const animationMode = props.mode === "animation";
  const dialogTitle = animationMode ? "Export Animation" : "Export Image";
  const aspectRatioLabel = formatAspectRatioLabel(props.aspectRatio);
  const durationSeconds = Math.max(0.1, props.animationDurationSeconds);
  const fps = Math.max(1, props.movieFps);
  const derivedFrameCount = Math.max(1, Math.round(durationSeconds * fps));
  const baseExportDisabled =
    props.isExporting ||
    props.width <= 0 ||
    props.height <= 0 ||
    props.subframes <= 0 ||
    (animationMode && !props.canAnimate);
  const movieConfigInvalid =
    props.movieFps <= 0 || props.movieBitrateMbps <= 0 || props.movieKeyframeInterval <= 0;
  const movieExportDisabled = baseExportDisabled || !animationMode || !props.movieSupported || movieConfigInvalid;
  const pngZipExportDisabled = baseExportDisabled || !animationMode;
  const stillExportDisabled = baseExportDisabled || animationMode;

  const primaryIsMovie = animationMode && props.animationFormat === "movie";
  const primaryExportDisabled = animationMode
    ? primaryIsMovie
      ? movieExportDisabled
      : pngZipExportDisabled
    : stillExportDisabled;

  const estimatedStill = formatBytes(estimateStillPngBytes(props.width, props.height));
  const estimatedZip = formatBytes(estimateAnimationZipBytes(props.width, props.height, derivedFrameCount));
  const estimatedMovie = formatBytes(estimateMovieBytes(durationSeconds, props.movieBitrateMbps));

  const estimateSummary = animationMode
    ? `Estimated: ${derivedFrameCount} frames, ${formatDurationLabel(durationSeconds)} at ${fps} FPS, ${
        props.animationFormat === "movie" ? `~${estimatedMovie} WebM` : `~${estimatedZip} PNG ZIP`
      }`
    : `Estimated: ~${estimatedStill} PNG at ${props.width}×${props.height}`;

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
            <h3 id="export-render-dialog-title">{dialogTitle}</h3>
          </div>
          {!props.isExporting ? (
            <AppButton onClick={props.onClose}>
              Close
            </AppButton>
          ) : null}
        </div>

        <div className="export-modal-body">
          <section className="export-section">
            <div className="section-header-row">
              <h3>Output size</h3>
            </div>
            <div className="export-preset-row">
              <span className="export-inline-label">Size presets</span>
              <AppButton onClick={() => props.onApplySizePreset("viewport")} disabled={props.isExporting}>Viewport</AppButton>
              <AppButton onClick={() => props.onApplySizePreset("hd")} disabled={props.isExporting}>HD</AppButton>
              <AppButton onClick={() => props.onApplySizePreset("4k")} disabled={props.isExporting}>4K</AppButton>
              <AppButton onClick={() => props.onApplySizePreset("square")} disabled={props.isExporting}>Square</AppButton>
            </div>
            <div className="export-grid export-grid-output">
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
                  <span>{props.aspectRatioLocked ? `Locked ${aspectRatioLabel}` : "Unlocked"}</span>
                  <ToggleSwitch
                    checked={props.aspectRatioLocked}
                    disabled={props.isExporting}
                    ariaLabel="Lock export aspect ratio"
                    onChange={props.onAspectRatioLockChange}
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
            </div>
          </section>

          <section className="export-section">
            <div className="section-header-row">
              <h3>Quality</h3>
            </div>
            <div className="export-preset-row">
              <span className="export-inline-label">Quality presets</span>
              <AppButton onClick={() => props.onApplyQualityPreset("draft")} disabled={props.isExporting}>Draft</AppButton>
              <AppButton onClick={() => props.onApplyQualityPreset("balanced")} disabled={props.isExporting}>Balanced</AppButton>
              <AppButton onClick={() => props.onApplyQualityPreset("final")} disabled={props.isExporting}>Final</AppButton>
            </div>
            <p className="muted">
              {animationMode
                ? "Quality presets target 5 / 25 / 50 total frames (Draft / Balanced / Final) and update encoding strength."
                : "Higher subframes reduce noise but increase render time."}
            </p>
          </section>

          {animationMode ? (
            <>
              <section className={`export-section export-timeline-info${props.canAnimate ? "" : " is-warning"}`}>
                <div className="section-header-row">
                  <h3>Timeline</h3>
                </div>
                <p className="muted">Animation export uses timeline keyframes from the main UI.</p>
                <p className="muted">Keyframes: {props.timelineKeyframeCount}</p>
                {!props.canAnimate ? (
                  <p className="dialog-warning">
                    Add at least two keyframes in Timeline before exporting animation.
                  </p>
                ) : null}
              </section>

              <section className="export-section">
                <div className="section-header-row">
                  <h3>Animation timing</h3>
                </div>
                <div className="export-grid export-grid-animation">
                  <label className="modal-field">
                    <span className="uniform-label">Duration (s)</span>
                    <input
                      type="number"
                      min={0.1}
                      max={3600}
                      step={0.1}
                      className="modal-input"
                      value={props.animationDurationSeconds}
                      disabled={props.isExporting}
                      onChange={(event) =>
                        props.onAnimationDurationSecondsChange(clampFloat(event.target.valueAsNumber, 0.1))
                      }
                    />
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
                  <div className="modal-field">
                    <span className="uniform-label">Total frames</span>
                    <div className="export-derived-field">{derivedFrameCount}</div>
                  </div>
                </div>
              </section>

              <section className="export-section">
                <div className="section-header-row">
                  <h3>Encoding</h3>
                </div>
                <div className="export-preset-row export-format-row">
                  <span className="export-inline-label">Format</span>
                  <AppButton
                    className={props.animationFormat === "movie" ? "is-selected" : ""}
                    onClick={() => props.onAnimationFormatChange("movie")}
                    disabled={props.isExporting || !props.movieSupported}
                  >
                    Movie (WebM)
                  </AppButton>
                  <AppButton
                    className={props.animationFormat === "png-zip" ? "is-selected" : ""}
                    onClick={() => props.onAnimationFormatChange("png-zip")}
                    disabled={props.isExporting}
                  >
                    PNG ZIP
                  </AppButton>
                </div>
                {props.animationFormat === "movie" ? (
                  props.movieSupported ? (
                    <>
                      <div className="export-grid export-grid-animation">
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
                          <span className="uniform-label">Keyframe interval</span>
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
                      <p className="muted">WebM (VP9) is usually the best browser-compatible quality choice.</p>
                    </>
                  ) : (
                    <p className="dialog-warning">
                      {props.movieUnavailableReason ?? "WebCodecs movie export is unavailable in this browser context."}
                    </p>
                  )
                ) : (
                  <p className="muted">PNG ZIP exports every rendered frame as lossless image files.</p>
                )}
              </section>
            </>
          ) : null}

          <div className="export-estimate-summary">{estimateSummary}</div>

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
        </div>

        <div className="modal-actions export-modal-actions">
          {!props.isExporting ? (
            <>
              <div className="export-modal-actions-left">
                <AppButton onClick={props.onClose}>
                  Cancel
                </AppButton>
              </div>
              <div className="export-modal-actions-right">
                {animationMode ? (
                  <>
                    {primaryIsMovie ? (
                      <AppButton onClick={props.onStartExport} disabled={pngZipExportDisabled}>
                        Export PNG ZIP
                      </AppButton>
                    ) : (
                      <AppButton onClick={props.onStartMovieExport} disabled={movieExportDisabled}>
                        Export Movie
                      </AppButton>
                    )}
                    <AppButton
                      variant="primary"
                      onClick={primaryIsMovie ? props.onStartMovieExport : props.onStartExport}
                      disabled={primaryExportDisabled}
                    >
                      {primaryIsMovie ? "Export Movie" : "Export PNG ZIP"}
                    </AppButton>
                  </>
                ) : (
                  <AppButton variant="primary" onClick={props.onStartExport} disabled={stillExportDisabled}>
                    Export PNG
                  </AppButton>
                )}
              </div>
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
