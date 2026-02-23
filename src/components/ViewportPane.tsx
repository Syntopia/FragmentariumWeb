import {
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef
} from "react";
import { CameraController, type CameraState } from "../core/geometry/camera";
import type { IntegratorDefinition, IntegratorOptionValues } from "../core/integrators/types";
import type { SourceLineRef, UniformDefinition, UniformValue } from "../core/parser/types";
import {
  FragmentRenderer,
  type RenderSettings,
  type SlicePlaneLockFrame,
  type RendererShaderErrorDetails,
  type RendererStatus
} from "../core/render/renderer";

interface ViewportPaneProps {
  geometrySource: string;
  geometryLineMap?: Array<SourceLineRef | null>;
  uniformDefinitions: UniformDefinition[];
  uniformValues: Record<string, UniformValue>;
  integrator: IntegratorDefinition;
  integratorOptions: IntegratorOptionValues;
  renderSettings: RenderSettings;
  cameraState: CameraState;
  slicePlaneLockFrame: SlicePlaneLockFrame | null;
  onCameraChange: (state: CameraState) => void;
  onFocusDistance: (distance: number | null) => void;
  onStatus: (status: RendererStatus) => void;
  onError: (error: RendererShaderErrorDetails | string | null) => void;
  disableGlobalShortcuts?: boolean;
}

const movementKeys = new Set(["w", "a", "s", "d", "q", "e", "r", "c", "y", "h", "g", "j"]);

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function ViewportPane(props: ViewportPaneProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FragmentRenderer | null>(null);
  const controllerRef = useRef<CameraController>(new CameraController());
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const modifierStateRef = useRef<{ shift: boolean; ctrl: boolean }>({ shift: false, ctrl: false });
  const isHoveringRef = useRef(false);
  const lastPointerUvRef = useRef<[number, number] | null>(null);
  const dragRef = useRef<{ pointerId: number; mode: "orbit" | "orbit-origin" | "pan" | "zoom" } | null>(null);

  const sceneKey = useMemo(
    () => `${props.integrator.id}::${props.geometrySource}`,
    [props.geometrySource, props.integrator.id]
  );

  useEffect(() => {
    controllerRef.current.setState(props.cameraState);
  }, [props.cameraState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    try {
      const renderer = new FragmentRenderer(canvas, {
        onStatus: props.onStatus
      });
      renderer.setRenderSettings(props.renderSettings);
      rendererRef.current = renderer;
      renderer.start();
      props.onError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      props.onError(message);
      return;
    }

    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [props.onError, props.onStatus]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }

    try {
      renderer.setScene({
        geometrySource: props.geometrySource,
        geometryLineMap: props.geometryLineMap,
        uniformDefinitions: props.uniformDefinitions,
        uniformValues: props.uniformValues,
        integrator: props.integrator,
        integratorOptions: props.integratorOptions
      });
      props.onError(null);
    } catch (error) {
      if (error instanceof Error && "details" in error && typeof (error as { details?: unknown }).details === "object") {
        const details = (error as { details: RendererShaderErrorDetails }).details;
        props.onError(details);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        props.onError(message);
      }
      return;
    }
  }, [sceneKey, props.geometryLineMap, props.geometrySource, props.integrator, props.onError, props.uniformDefinitions]);

  useEffect(() => {
    rendererRef.current?.updateUniformValues(props.uniformValues);
  }, [props.uniformValues]);

  useEffect(() => {
    rendererRef.current?.updateIntegratorOptions(props.integratorOptions);
  }, [props.integratorOptions]);

  useEffect(() => {
    rendererRef.current?.updateSlicePlaneLockFrame(props.slicePlaneLockFrame);
  }, [props.slicePlaneLockFrame]);

  useEffect(() => {
    rendererRef.current?.setRenderSettings(props.renderSettings);
  }, [props.renderSettings]);

  useEffect(() => {
    rendererRef.current?.setCamera(props.cameraState);
  }, [props.cameraState]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const renderer = rendererRef.current;
    if (wrapper === null || renderer === null) {
      return;
    }

    const resize = (): void => {
      const rect = wrapper.getBoundingClientRect();
      renderer.setDisplaySize(rect.width, rect.height, window.devicePixelRatio || 1);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    resize();

    return () => observer.disconnect();
  }, [sceneKey]);

  useEffect(() => {
    let raf = 0;
    let previous = performance.now();

    const update = (now: number): void => {
      const controller = controllerRef.current;
      const keys = pressedKeysRef.current;
      const modifiers = modifierStateRef.current;
      const speedMultiplier = (modifiers.shift ? 0.2 : 1) * (modifiers.ctrl ? 5 : 1);
      const delta = Math.min((now - previous) / 16.666, 3);
      previous = now;

      if (!props.disableGlobalShortcuts && keys.size > 0 && controller.updateFromKeys(keys, delta * speedMultiplier)) {
        const next = controller.getState();
        rendererRef.current?.setCamera(next);
        props.onCameraChange(next);
      }

      raf = requestAnimationFrame(update);
    };

    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [props.disableGlobalShortcuts, props.onCameraChange]);

  useEffect(() => {
    if (!props.disableGlobalShortcuts) {
      return;
    }
    pressedKeysRef.current.clear();
    modifierStateRef.current = { shift: false, ctrl: false };
  }, [props.disableGlobalShortcuts]);

  const pushCamera = (): void => {
    const next = controllerRef.current.getState();
    rendererRef.current?.setCamera(next);
    props.onCameraChange(next);
  };

  const updatePointerUv = (clientX: number, clientY: number): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = (clientX - rect.left) / rect.width;
    const yFromTop = (clientY - rect.top) / rect.height;
    const y = 1 - yFromTop;
    lastPointerUvRef.current = [
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y))
    ];
  };

  const requestFocusProbe = useCallback((): void => {
    const focusUv = lastPointerUvRef.current;
    if (focusUv === null) {
      console.info("[viewport] Focus probe skipped: mouse position is unavailable.");
      props.onFocusDistance(null);
      return;
    }

    const distance = rendererRef.current?.sampleFocusDistance(focusUv) ?? null;
    if (distance !== null) {
      console.info(
        `[viewport] Focus probe distance=${distance.toFixed(4)} at uv=(${focusUv[0].toFixed(3)}, ${focusUv[1].toFixed(3)}).`
      );
    } else {
      console.info("[viewport] Focus probe returned no hit.");
    }
    props.onFocusDistance(distance);
  }, [props.onFocusDistance]);

  useEffect(() => {
    const setModifiersFromEvent = (event: KeyboardEvent): void => {
      modifierStateRef.current = {
        shift: event.shiftKey,
        ctrl: event.ctrlKey
      };
    };

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (props.disableGlobalShortcuts) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      if (isEditableEventTarget(event.target)) {
        return;
      }
      setModifiersFromEvent(event);

      const key = event.key.toLowerCase();

      if (key === "f") {
        if (!event.repeat) {
          event.preventDefault();
          requestFocusProbe();
        }
        return;
      }

      if (key === "1") {
        controllerRef.current.adjustStepSize(0.5);
        event.preventDefault();
        return;
      }
      if (key === "2") {
        controllerRef.current.adjustStepSize(10);
        event.preventDefault();
        return;
      }
      if (key === "3") {
        controllerRef.current.adjustStepSize(2);
        event.preventDefault();
        return;
      }
      if (key === "x") {
        controllerRef.current.adjustStepSize(0.1);
        event.preventDefault();
        return;
      }

      if (movementKeys.has(key)) {
        pressedKeysRef.current.add(key);
        event.preventDefault();
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent): void => {
      setModifiersFromEvent(event);
      if (props.disableGlobalShortcuts) {
        return;
      }
      if (isEditableEventTarget(event.target)) {
        return;
      }
      pressedKeysRef.current.delete(event.key.toLowerCase());
    };

    const handleWindowBlur = (): void => {
      pressedKeysRef.current.clear();
      modifierStateRef.current = { shift: false, ctrl: false };
      dragRef.current = null;
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [props.disableGlobalShortcuts, requestFocusProbe]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    updatePointerUv(event.clientX, event.clientY);
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);

    const mode: "orbit" | "orbit-origin" | "pan" | "zoom" =
      event.button === 2 ? "pan" : event.button === 1 ? "zoom" : event.shiftKey ? "orbit-origin" : "orbit";

    dragRef.current = {
      pointerId: event.pointerId,
      mode
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    updatePointerUv(event.clientX, event.clientY);

    if (dragRef.current === null || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const controller = controllerRef.current;
    if (dragRef.current.mode === "orbit") {
      controller.orbitFromDrag(event.movementX, event.movementY);
    } else if (dragRef.current.mode === "orbit-origin") {
      controller.orbitAroundOriginFromDrag(event.movementX, event.movementY);
    } else if (dragRef.current.mode === "pan") {
      controller.panFromDrag(event.movementX, event.movementY);
    } else {
      controller.zoomFromDrag(event.movementY);
    }

    pushCamera();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current === null || dragRef.current.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
  };

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    controllerRef.current.dollyFromWheel(event.deltaY, event.shiftKey);
    pushCamera();
  };

  return (
    <div className="viewport-pane" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        tabIndex={0}
        onPointerEnter={(event) => {
          updatePointerUv(event.clientX, event.clientY);
          isHoveringRef.current = true;
        }}
        onPointerLeave={() => {
          isHoveringRef.current = false;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
        onBlur={() => {
          pressedKeysRef.current.clear();
          dragRef.current = null;
        }}
      />
    </div>
  );
}
