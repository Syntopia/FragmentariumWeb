import type { ReactNode } from "react";

interface BlockingTaskDialogProps {
  open: boolean;
  title: string;
  message: string;
  detail?: string | null;
  progress?: number | null;
  footer?: ReactNode;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function BlockingTaskDialog(props: BlockingTaskDialogProps): JSX.Element | null {
  if (!props.open) {
    return null;
  }

  const progressValue = props.progress === undefined || props.progress === null ? null : clamp01(props.progress);

  return (
    <div className="modal-backdrop" aria-live="polite" aria-busy="true">
      <div className="modal-window blocking-task-modal-window" role="dialog" aria-modal="true" aria-labelledby="blocking-task-title">
        <h3 id="blocking-task-title">{props.title}</h3>
        <p className="muted">{props.message}</p>
        {props.detail !== undefined && props.detail !== null && props.detail.length > 0 ? (
          <p className="blocking-task-detail">{props.detail}</p>
        ) : null}
        {progressValue !== null ? (
          <div className="blocking-task-progress" aria-label="Progress">
            <div className="blocking-task-progress-fill" style={{ width: `${(progressValue * 100).toFixed(1)}%` }} />
          </div>
        ) : null}
        {props.footer !== undefined ? <div className="blocking-task-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}
