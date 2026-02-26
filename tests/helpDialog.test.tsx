import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { HelpDialog } from "../src/components/HelpDialog";
import type { RendererGraphicsDiagnostics } from "../src/core/render/renderer";

function makeDiagnostics(overrides?: Partial<RendererGraphicsDiagnostics>): RendererGraphicsDiagnostics {
  const base: RendererGraphicsDiagnostics = {
    webglVersion: "WebGL 2.0",
    shadingLanguageVersion: "WebGL GLSL ES 3.00",
    vendor: "WebKit",
    renderer: "WebKit WebGL",
    unmaskedVendor: "NVIDIA Corporation",
    unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX, D3D11)",
    angleInfo: "ANGLE (NVIDIA, NVIDIA GeForce RTX, D3D11)",
    contextAttributes: {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
      powerPreference: "high-performance"
    },
    limits: {
      maxTextureSize: 16384,
      maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384],
      maxColorAttachments: 8,
      maxDrawBuffers: 8,
      maxTextureImageUnits: 16,
      maxCombinedTextureImageUnits: 32,
      maxFragmentUniformVectors: 1024,
      maxSamples: 4
    },
    extensions: {
      extColorBufferFloat: true,
      extColorBufferHalfFloat: true,
      webglDebugRendererInfo: true,
      extDisjointTimerQueryWebgl2: false
    },
    capabilities: [
      { label: "WebGL2 context", required: true, available: true },
      { label: "EXT_color_buffer_float", required: true, available: true },
      { label: "WEBGL_debug_renderer_info", required: false, available: true }
    ]
  };
  return { ...base, ...overrides };
}

describe("HelpDialog", () => {
  test("shows graphics diagnostics and flags missing required capabilities", () => {
    const diagnostics = makeDiagnostics({
      capabilities: [
        { label: "WebGL2 context", required: true, available: true },
        { label: "EXT_color_buffer_float", required: true, available: false }
      ]
    });

    render(
      <HelpDialog
        open={true}
        versionLabel="v0.9.234"
        graphicsDiagnostics={diagnostics}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText("Graphics Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Shift + W / A / S / D")).toBeInTheDocument();
    expect(screen.getByText(/Missing required capability: EXT_color_buffer_float/)).toBeInTheDocument();
    expect(screen.getByText("ANGLE / Backend")).toBeInTheDocument();
    expect(screen.getAllByText(/D3D11/).length).toBeGreaterThan(0);
    expect(screen.getByText("EXT_color_buffer_float (required)")).toBeInTheDocument();
  });
});
