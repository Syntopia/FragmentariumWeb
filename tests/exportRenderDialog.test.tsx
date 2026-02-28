import { render, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  ExportRenderDialog,
  type ExportRenderDialogProps
} from "../src/components/ExportRenderDialog";

function makeProps(overrides?: Partial<ExportRenderDialogProps>): ExportRenderDialogProps {
  const base: ExportRenderDialogProps = {
    open: true,
    canAnimate: true,
    timelineKeyframeCount: 3,
    mode: "animation",
    width: 1920,
    height: 1080,
    aspectRatioLocked: true,
    aspectRatio: 16 / 9,
    subframes: 3,
    animationDurationSeconds: 1.5,
    animationFormat: "movie",
    movieSupported: true,
    movieUnavailableReason: null,
    movieCodec: "vp9",
    movieFps: 24,
    movieBitrateMbps: 12,
    movieKeyframeInterval: 30,
    statusMessage: null,
    isExporting: false,
    progress: null,
    onClose: () => undefined,
    onStartExport: () => undefined,
    onStartMovieExport: () => undefined,
    onCancelExport: () => undefined,
    onWidthChange: () => undefined,
    onHeightChange: () => undefined,
    onAspectRatioLockChange: () => undefined,
    onSubframesChange: () => undefined,
    onAnimationDurationSecondsChange: () => undefined,
    onAnimationFormatChange: () => undefined,
    onMovieCodecChange: () => undefined,
    onMovieFpsChange: () => undefined,
    onMovieBitrateMbpsChange: () => undefined,
    onMovieKeyframeIntervalChange: () => undefined,
    onApplySizePreset: () => undefined,
    onApplyQualityPreset: () => undefined
  };
  return {
    ...base,
    ...overrides
  };
}

describe("ExportRenderDialog", () => {
  test("shows animation timing with derived frame count and timeline context", () => {
    const view = render(<ExportRenderDialog {...makeProps()} />);
    const dialog = within(view.container);

    expect(dialog.getByText("Export Animation")).toBeInTheDocument();
    expect(dialog.getByText("Animation timing")).toBeInTheDocument();
    expect(dialog.getByText("Keyframes: 3")).toBeInTheDocument();
    expect(dialog.getByText("Total frames")).toBeInTheDocument();
    expect(dialog.getByText("36")).toBeInTheDocument();
    expect(dialog.getAllByRole("button", { name: "Export Movie" }).at(-1)).toBeEnabled();
    expect(dialog.getByRole("button", { name: "Export PNG ZIP" })).toBeEnabled();
  });

  test("shows timeline warning and disables animation export when timeline is insufficient", () => {
    const view = render(
      <ExportRenderDialog
        {...makeProps({
          canAnimate: false,
          timelineKeyframeCount: 1
        })}
      />
    );
    const dialog = within(view.container);

    expect(dialog.getByText("Export Animation")).toBeInTheDocument();
    expect(dialog.getByText(/Add at least two keyframes in Timeline/)).toBeInTheDocument();
    expect(dialog.getAllByRole("button", { name: "Export Movie" }).at(-1)).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Export PNG ZIP" })).toBeDisabled();
  });

  test("shows still-only controls in still mode", () => {
    const view = render(
      <ExportRenderDialog
        {...makeProps({
          mode: "still"
        })}
      />
    );
    const dialog = within(view.container);

    expect(dialog.getByText("Export Image")).toBeInTheDocument();
    expect(dialog.queryByText("Animation timing")).not.toBeInTheDocument();
    expect(dialog.queryByText("Encoding")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Export PNG" })).toBeEnabled();
  });
});
