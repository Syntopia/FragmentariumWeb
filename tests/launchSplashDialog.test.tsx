import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LaunchSplashDialog } from "../src/components/LaunchSplashDialog";

function createMockWebGl2Context(): WebGL2RenderingContext {
  const gl: Partial<WebGL2RenderingContext> = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    TRIANGLES: 0x0004,
    createShader: () => ({} as WebGLShader),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => undefined,
    createProgram: () => ({} as WebGLProgram),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: () => undefined,
    createBuffer: () => ({} as WebGLBuffer),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    getUniformLocation: () => ({} as WebGLUniformLocation),
    useProgram: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    uniform1f: () => undefined,
    uniform2f: () => undefined,
    drawArrays: () => undefined,
    viewport: () => undefined,
    deleteBuffer: () => undefined,
    getExtension: ((name: string) => {
      if (name === "EXT_color_buffer_float") {
        return {} as EXT_color_buffer_float;
      }
      return null;
    }) as WebGL2RenderingContext["getExtension"]
  };
  return gl as WebGL2RenderingContext;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LaunchSplashDialog", () => {
  test("does not render when closed", () => {
    const view = render(
      <LaunchSplashDialog open={false} versionLabel="v0.0.0 (2026-02-28)" onClose={() => undefined} />
    );
    expect(view.container.firstChild).toBeNull();
  });

  test("shows staged startup text and closes on click only when ready", () => {
    vi.useFakeTimers();
    const gl = createMockWebGl2Context();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => gl);
    const onClose = vi.fn();

    render(<LaunchSplashDialog open={true} versionLabel="v1.2.3 (2026-02-28)" onClose={onClose} />);

    expect(screen.getByText("Fragmentarium Web")).toBeInTheDocument();
    expect(screen.getByText("v1.2.3 (2026-02-28)")).toBeInTheDocument();
    expect(screen.getByText("Initializing GUI...")).toBeInTheDocument();

    const splashButton = screen.getByRole("button", { name: "Start application" });
    fireEvent.click(splashButton);
    expect(onClose).toHaveBeenCalledTimes(0);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText("Checking GPU requirements...")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText("Click to start")).toBeInTheDocument();

    fireEvent.click(splashButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
