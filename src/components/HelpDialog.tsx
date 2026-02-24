import { AppButton } from "./AppButton";
import type { RendererGraphicsCapabilityStatus, RendererGraphicsDiagnostics } from "../core/render/renderer";

interface HelpDialogProps {
  open: boolean;
  versionLabel: string;
  graphicsDiagnostics: RendererGraphicsDiagnostics | null;
  onClose: () => void;
}

const KEYBOARD_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "W / A / S / D", action: "Move camera (forward / left / back / right, camera-relative)" },
  { keys: "R / C", action: "Move camera down / up (world Y)" },
  { keys: "Q / E", action: "Roll camera left / right" },
  { keys: "G / J", action: "Rotate system around origin left / right (same as Shift+drag, screen horizontal)" },
  { keys: "Y / H", action: "Rotate system around origin up / down (same as Shift+drag, screen vertical)" },
  { keys: "F", action: "Focus depth-of-field at mouse cursor in 3D view" },
  { keys: "Shift", action: "5x smaller movement / rotation steps (modifier)" },
  { keys: "Ctrl", action: "5x larger movement / rotation steps (modifier)" },
  { keys: "1 / 2 / 3 / X", action: "Adjust base camera step size" }
];

const MOUSE_SHORTCUTS: Array<{ gesture: string; action: string }> = [
  { gesture: "Left drag", action: "Orbit view (camera turns around eye)" },
  { gesture: "Shift + Left drag", action: "Rotate system around origin" },
  { gesture: "Right drag", action: "Pan camera" },
  { gesture: "Middle drag", action: "Zoom (FOV)" },
  { gesture: "Mouse wheel", action: "Dolly forward/back" },
  { gesture: "Shift + Mouse wheel", action: "Adjust camera step size" }
];

export function HelpDialog(props: HelpDialogProps): JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div className="modal-window help-modal-window" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
        <div className="help-modal-header">
          <div>
            <h3 id="help-dialog-title">Help</h3>
            <div className="help-version">Fragmentarium Web {props.versionLabel}</div>
          </div>
          <AppButton onClick={props.onClose}>
            Close
          </AppButton>
        </div>

        <div className="help-section">
          <h4>Keyboard Shortcuts</h4>
          <div className="help-shortcut-list">
            {KEYBOARD_SHORTCUTS.map((entry) => (
              <div key={entry.keys} className="help-shortcut-row">
                <span className="help-shortcut-keys">{entry.keys}</span>
                <span className="help-shortcut-action">{entry.action}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="help-section">
          <h4>Mouse Controls</h4>
          <div className="help-shortcut-list">
            {MOUSE_SHORTCUTS.map((entry) => (
              <div key={entry.gesture} className="help-shortcut-row">
                <span className="help-shortcut-keys">{entry.gesture}</span>
                <span className="help-shortcut-action">{entry.action}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="help-section">
          <h4>Graphics Diagnostics</h4>
          {props.graphicsDiagnostics === null ? (
            <p className="muted">Graphics diagnostics unavailable (renderer not initialized).</p>
          ) : (
            <div className="help-diagnostics">
              <DiagnosticsSummary diagnostics={props.graphicsDiagnostics} />
              <DiagnosticsCapabilities capabilities={props.graphicsDiagnostics.capabilities} />
              <DiagnosticsKeyValueList
                title="Context"
                rows={[
                  ["WebGL", props.graphicsDiagnostics.webglVersion],
                  ["GLSL", props.graphicsDiagnostics.shadingLanguageVersion],
                  ["Vendor", props.graphicsDiagnostics.vendor],
                  ["Renderer", props.graphicsDiagnostics.renderer],
                  ["Unmasked Vendor", props.graphicsDiagnostics.unmaskedVendor ?? "Unavailable"],
                  ["Unmasked Renderer", props.graphicsDiagnostics.unmaskedRenderer ?? "Unavailable"],
                  ["ANGLE / Backend", props.graphicsDiagnostics.angleInfo ?? "Not detected"]
                ]}
              />
              <DiagnosticsKeyValueList
                title="Context Attributes"
                rows={formatContextAttributeRows(props.graphicsDiagnostics)}
              />
              <DiagnosticsKeyValueList
                title="Limits"
                rows={[
                  ["Max texture size", String(props.graphicsDiagnostics.limits.maxTextureSize)],
                  ["Max renderbuffer size", String(props.graphicsDiagnostics.limits.maxRenderbufferSize)],
                  [
                    "Max viewport dims",
                    `${props.graphicsDiagnostics.limits.maxViewportDims[0]} x ${props.graphicsDiagnostics.limits.maxViewportDims[1]}`
                  ],
                  ["Max color attachments", String(props.graphicsDiagnostics.limits.maxColorAttachments)],
                  ["Max draw buffers", String(props.graphicsDiagnostics.limits.maxDrawBuffers)],
                  ["Max texture image units", String(props.graphicsDiagnostics.limits.maxTextureImageUnits)],
                  [
                    "Max combined texture units",
                    String(props.graphicsDiagnostics.limits.maxCombinedTextureImageUnits)
                  ],
                  [
                    "Max fragment uniform vectors",
                    String(props.graphicsDiagnostics.limits.maxFragmentUniformVectors)
                  ],
                  ["Max samples", String(props.graphicsDiagnostics.limits.maxSamples)]
                ]}
              />
              <DiagnosticsKeyValueList
                title="Extensions"
                rows={[
                  [
                    "EXT_color_buffer_float",
                    props.graphicsDiagnostics.extensions.extColorBufferFloat ? "Available" : "Missing"
                  ],
                  [
                    "EXT_color_buffer_half_float",
                    props.graphicsDiagnostics.extensions.extColorBufferHalfFloat ? "Available" : "Missing"
                  ],
                  [
                    "WEBGL_debug_renderer_info",
                    props.graphicsDiagnostics.extensions.webglDebugRendererInfo ? "Available" : "Missing"
                  ],
                  [
                    "EXT_disjoint_timer_query_webgl2",
                    props.graphicsDiagnostics.extensions.extDisjointTimerQueryWebgl2 ? "Available" : "Missing"
                  ]
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DiagnosticsKeyValueListProps {
  title: string;
  rows: Array<[label: string, value: string]>;
}

function DiagnosticsKeyValueList(props: DiagnosticsKeyValueListProps): JSX.Element {
  return (
    <div className="help-diagnostics-block">
      <div className="help-diagnostics-block-title">{props.title}</div>
      <div className="help-diagnostics-list">
        {props.rows.map(([label, value]) => (
          <div key={label} className="help-diagnostics-row">
            <span className="help-diagnostics-label">{label}</span>
            <span className="help-diagnostics-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsSummary({ diagnostics }: { diagnostics: RendererGraphicsDiagnostics }): JSX.Element {
  const missingRequired = diagnostics.capabilities.filter((entry) => entry.required && !entry.available);
  const warningClassName = missingRequired.length > 0 ? "help-diagnostics-banner warning" : "help-diagnostics-banner";
  const message =
    missingRequired.length > 0
      ? `Missing required capability: ${missingRequired.map((entry) => entry.label).join(", ")}`
      : "Required capabilities OK";
  return <div className={warningClassName}>{message}</div>;
}

function DiagnosticsCapabilities({
  capabilities
}: {
  capabilities: RendererGraphicsCapabilityStatus[];
}): JSX.Element {
  return (
    <div className="help-diagnostics-block">
      <div className="help-diagnostics-block-title">Capability Checks</div>
      <div className="help-diagnostics-capability-list">
        {capabilities.map((entry) => {
          const statusClassName = entry.available ? "ok" : entry.required ? "error" : "muted";
          return (
            <div key={entry.label} className="help-diagnostics-capability-row">
              <span className={`help-diagnostics-capability-status ${statusClassName}`}>
                {entry.available ? "OK" : entry.required ? "Missing" : "Unavailable"}
              </span>
              <span className="help-diagnostics-capability-label">
                {entry.label}
                {entry.required ? " (required)" : ""}
              </span>
              {entry.detail ? <span className="help-diagnostics-capability-detail">{entry.detail}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatContextAttributeRows(diagnostics: RendererGraphicsDiagnostics): Array<[string, string]> {
  if (diagnostics.contextAttributes === null) {
    return [["Context attributes", "Unavailable"]];
  }
  const attrs = diagnostics.contextAttributes;
  const rows: Array<[string, string]> = [
    ["Alpha", formatBool(attrs.alpha)],
    ["Antialias", formatBool(attrs.antialias)],
    ["Depth", formatBool(attrs.depth)],
    ["Stencil", formatBool(attrs.stencil)],
    ["Preserve drawing buffer", formatBool(attrs.preserveDrawingBuffer)],
    ["Premultiplied alpha", formatBool(attrs.premultipliedAlpha)]
  ];
  if (attrs.powerPreference !== undefined) {
    rows.push(["Power preference", attrs.powerPreference]);
  }
  if (attrs.desynchronized !== undefined) {
    rows.push(["Desynchronized", formatBool(attrs.desynchronized)]);
  }
  if (attrs.failIfMajorPerformanceCaveat !== undefined) {
    rows.push(["Fail if perf caveat", formatBool(attrs.failIfMajorPerformanceCaveat)]);
  }
  if (attrs.xrCompatible !== undefined) {
    rows.push(["XR compatible", formatBool(attrs.xrCompatible)]);
  }
  return rows;
}

function formatBool(value: boolean | undefined): string {
  if (value === undefined) {
    return "Unavailable";
  }
  return value ? "Yes" : "No";
}
