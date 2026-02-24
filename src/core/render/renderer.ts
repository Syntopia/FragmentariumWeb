import type { CameraState } from "../geometry/camera";
import type { IntegratorDefinition, IntegratorOptionValues } from "../integrators/types";
import type { SourceLineRef, UniformDefinition, UniformValue } from "../parser/types";
import {
  assertWebGl2,
  createProgram,
  createRenderTarget,
  deleteRenderTarget,
  WebGlShaderCompileError,
  type RenderTarget,
  requireFloatColorBufferSupport
} from "./glUtils";
import {
  formatMappedShaderDiagnostics,
  mapShaderCompilerDiagnostics,
  parseShaderCompilerLog,
  type MappedShaderCompilerDiagnostic
} from "./shaderDiagnostics";
import { buildDisplayShaderSources, buildFocusProbeShaderSources, buildSceneShaderSources } from "./shaderComposer";

interface SceneState {
  geometrySource: string;
  geometryLineMap?: Array<SourceLineRef | null>;
  uniformDefinitions: UniformDefinition[];
  uniformValues: Record<string, UniformValue>;
  integrator: IntegratorDefinition;
  integratorOptions: IntegratorOptionValues;
}

export interface RendererShaderErrorDetails {
  stage: "scene" | "focus";
  shaderKind: "vertex" | "fragment";
  rawLog: string;
  diagnostics: MappedShaderCompilerDiagnostic[];
  message: string;
}

export class RendererShaderProgramError extends Error {
  readonly details: RendererShaderErrorDetails;

  constructor(details: RendererShaderErrorDetails) {
    super(details.message);
    this.name = "RendererShaderProgramError";
    this.details = details;
  }
}

export interface RendererStatus {
  fps: number;
  subframe: number;
  scale: number;
  resolution: [number, number];
  maxSubframes: number;
  tileCount: number;
  tileCursor: number;
}

interface RendererOptions {
  onStatus: (status: RendererStatus) => void;
}

export interface RendererExportProgress {
  progress: number;
  subframe: number;
  tileCursor: number;
  totalSubframes: number;
  tileCount: number;
}

export interface RendererGraphicsCapabilityStatus {
  label: string;
  required: boolean;
  available: boolean;
  detail?: string;
}

export interface RendererGraphicsDiagnostics {
  webglVersion: string;
  shadingLanguageVersion: string;
  vendor: string;
  renderer: string;
  unmaskedVendor: string | null;
  unmaskedRenderer: string | null;
  angleInfo: string | null;
  contextAttributes: {
    alpha?: boolean;
    antialias?: boolean;
    depth?: boolean;
    desynchronized?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    powerPreference?: string;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    stencil?: boolean;
    xrCompatible?: boolean;
  } | null;
  limits: {
    maxTextureSize: number;
    maxRenderbufferSize: number;
    maxViewportDims: [number, number];
    maxColorAttachments: number;
    maxDrawBuffers: number;
    maxTextureImageUnits: number;
    maxCombinedTextureImageUnits: number;
    maxFragmentUniformVectors: number;
    maxSamples: number;
  };
  extensions: {
    extColorBufferFloat: boolean;
    extColorBufferHalfFloat: boolean;
    webglDebugRendererInfo: boolean;
    extDisjointTimerQueryWebgl2: boolean;
  };
  capabilities: RendererGraphicsCapabilityStatus[];
}

export interface RenderStillFrameOptions {
  width: number;
  height: number;
  subframes: number;
  signal?: AbortSignal;
  onProgress?: (progress: RendererExportProgress) => void;
  timeSeconds?: number;
}

export interface RenderStillPngOptions extends RenderStillFrameOptions {}

const INTERACTION_WINDOW_MS = 350;
const STATUS_INTERVAL_MS = 500;

export interface RenderSettings {
  interactionResolutionScale: number;
  maxSubframes: number;
  tileCount: number;
  tilesPerFrame: number;
  toneMapping: number;
  exposure: number;
  gamma: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  interactionResolutionScale: 0.75,
  maxSubframes: 30,
  tileCount: 1,
  tilesPerFrame: 1,
  toneMapping: 4,
  exposure: 1,
  gamma: 2.2,
  brightness: 1,
  contrast: 1,
  saturation: 1
};

interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Vec3Tuple = [number, number, number];

export interface SlicePlaneLockFrame {
  origin: Vec3Tuple;
  normal: Vec3Tuple;
}

export class FragmentRenderer {
  private readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;

  private readonly onStatus: (status: RendererStatus) => void;

  private displayProgram: WebGLProgram;

  private sceneProgram: WebGLProgram | null = null;

  private focusProbeProgram: WebGLProgram | null = null;

  private focusProbeTarget: RenderTarget | null = null;

  private readTarget: RenderTarget | null = null;

  private writeTarget: RenderTarget | null = null;

  private currentWidth = 0;

  private currentHeight = 0;

  private currentScale = 1;

  private dpr = 1;

  private rafId = 0;

  private running = false;

  private dirty = true;

  private lastInteractionMs = 0;

  private subframe = 0;

  private frameCounter = 0;

  private frameCounterStart = performance.now();

  private lastStatusMs = 0;

  private sceneState: SceneState | null = null;

  private renderSettings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS };

  private tileCursor = 0;

  private wasInteracting = false;

  private camera: CameraState = {
    eye: [0, 0, -6],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 0.4
  };

  private readonly focusProbeReadback = new Float32Array(4);

  private frameSeed = 1;

  private cameraRayResolutionOverride: [number, number] | null = null;

  private cameraRayPixelOffsetOverride: [number, number] = [0, 0];

  private slicePlaneLockWasEnabled = false;

  private slicePlaneLockAnchorOrigin: Vec3Tuple | null = null;

  private slicePlaneLockAnchorNormal: Vec3Tuple | null = null;

  private slicePlaneLockFrameExternal: SlicePlaneLockFrame | null = null;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions) {
    this.canvas = canvas;
    this.gl = assertWebGl2(canvas);
    requireFloatColorBufferSupport(this.gl);
    this.onStatus = options.onStatus;

    const displaySources = buildDisplayShaderSources();
    this.displayProgram = createProgram(this.gl, displaySources.vertexSource, displaySources.fragmentSource);

    console.info("[renderer] WebGL2 initialized.");
  }

  getGraphicsDiagnostics(): RendererGraphicsDiagnostics {
    const gl = this.gl;
    const debugRendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const extColorBufferFloat = gl.getExtension("EXT_color_buffer_float");
    const extColorBufferHalfFloat = gl.getExtension("EXT_color_buffer_half_float");
    const extDisjointTimerQueryWebgl2 = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const contextAttributes = gl.getContextAttributes();
    const contextAttributesExtended = contextAttributes as (WebGLContextAttributes & {
      desynchronized?: boolean;
      failIfMajorPerformanceCaveat?: boolean;
      powerPreference?: string;
      xrCompatible?: boolean;
    }) | null;
    const rendererString = gl.getParameter(gl.RENDERER) as string;
    const angleInfo = extractAngleInfo(rendererString);

    const capabilities: RendererGraphicsCapabilityStatus[] = [
      {
        label: "WebGL2 context",
        required: true,
        available: true
      },
      {
        label: "EXT_color_buffer_float",
        required: true,
        available: extColorBufferFloat !== null,
        detail: extColorBufferFloat !== null ? "Required for progressive float accumulation targets" : undefined
      },
      {
        label: "WEBGL_debug_renderer_info",
        required: false,
        available: debugRendererInfo !== null,
        detail: "Allows unmasked GPU vendor/renderer strings"
      }
    ];

    return {
      webglVersion: gl.getParameter(gl.VERSION) as string,
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string,
      vendor: gl.getParameter(gl.VENDOR) as string,
      renderer: rendererString,
      unmaskedVendor:
        debugRendererInfo !== null
          ? (gl.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL) as string)
          : null,
      unmaskedRenderer:
        debugRendererInfo !== null
          ? (gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL) as string)
          : null,
      angleInfo,
      contextAttributes:
        contextAttributesExtended === null
          ? null
          : {
              alpha: contextAttributesExtended.alpha,
              antialias: contextAttributesExtended.antialias,
              depth: contextAttributesExtended.depth,
              desynchronized: contextAttributesExtended.desynchronized,
              failIfMajorPerformanceCaveat: contextAttributesExtended.failIfMajorPerformanceCaveat,
              powerPreference: contextAttributesExtended.powerPreference,
              premultipliedAlpha: contextAttributesExtended.premultipliedAlpha,
              preserveDrawingBuffer: contextAttributesExtended.preserveDrawingBuffer,
              stencil: contextAttributesExtended.stencil,
              xrCompatible: contextAttributesExtended.xrCompatible
            },
      limits: {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS) as [number, number],
        maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number,
        maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS) as number,
        maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
        maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number,
        maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number,
        maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number
      },
      extensions: {
        extColorBufferFloat: extColorBufferFloat !== null,
        extColorBufferHalfFloat: extColorBufferHalfFloat !== null,
        webglDebugRendererInfo: debugRendererInfo !== null,
        extDisjointTimerQueryWebgl2: extDisjointTimerQueryWebgl2 !== null
      },
      capabilities
    };
  }

  setScene(next: SceneState): void {
    console.info(
      `[renderer] Rebuilding scene program (integrator=${next.integrator.id}, uniforms=${next.uniformDefinitions.length}).`
    );

    const sources = buildSceneShaderSources({
      geometrySource: next.geometrySource,
      geometryLineMap: next.geometryLineMap,
      integrator: next.integrator
    });

    const focusProbeSources = buildFocusProbeShaderSources({
      geometrySource: next.geometrySource,
      geometryLineMap: next.geometryLineMap
    });

    let program: WebGLProgram;
    try {
      program = createProgram(this.gl, sources.vertexSource, sources.fragmentSource);
    } catch (error) {
      throw this.wrapShaderBuildError(error, "scene", sources.fragmentLineMap);
    }
    let focusProgram: WebGLProgram;
    try {
      focusProgram = createProgram(this.gl, focusProbeSources.vertexSource, focusProbeSources.fragmentSource);
    } catch (error) {
      this.gl.deleteProgram(program);
      throw this.wrapShaderBuildError(error, "focus", focusProbeSources.fragmentLineMap);
    }
    if (this.sceneProgram !== null) {
      this.gl.deleteProgram(this.sceneProgram);
    }
    if (this.focusProbeProgram !== null) {
      this.gl.deleteProgram(this.focusProbeProgram);
    }
    this.sceneProgram = program;
    this.focusProbeProgram = focusProgram;

    this.sceneState = {
      geometrySource: next.geometrySource,
      geometryLineMap: next.geometryLineMap,
      uniformDefinitions: next.uniformDefinitions,
      uniformValues: { ...next.uniformValues },
      integrator: next.integrator,
      integratorOptions: { ...next.integratorOptions }
    };

    this.markDirty();
  }

  private wrapShaderBuildError(
    error: unknown,
    stage: "scene" | "focus",
    fragmentLineMap: Array<SourceLineRef | null> | undefined
  ): Error {
    if (!(error instanceof WebGlShaderCompileError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    const diagnostics = mapShaderCompilerDiagnostics(
      parseShaderCompilerLog(error.log),
      error.shaderKind === "fragment" ? fragmentLineMap : undefined
    );
    const mappedSummary = formatMappedShaderDiagnostics(diagnostics);
    const message = `Shader error (${stage} ${error.shaderKind}): ${error.log}${
      mappedSummary.length > 0 ? `\nMapped diagnostics:\n${mappedSummary}` : ""
    }`;
    return new RendererShaderProgramError({
      stage,
      shaderKind: error.shaderKind,
      rawLog: error.log,
      diagnostics,
      message
    });
  }

  setRenderSettings(next: Partial<RenderSettings>): void {
    const updated: RenderSettings = {
      interactionResolutionScale: clamp(next.interactionResolutionScale ?? this.renderSettings.interactionResolutionScale, 0.25, 1),
      maxSubframes: Math.max(0, Math.round(next.maxSubframes ?? this.renderSettings.maxSubframes)),
      tileCount: Math.max(1, Math.round(next.tileCount ?? this.renderSettings.tileCount)),
      tilesPerFrame: Math.max(1, Math.round(next.tilesPerFrame ?? this.renderSettings.tilesPerFrame)),
      toneMapping: clamp(Math.round(next.toneMapping ?? this.renderSettings.toneMapping), 1, 4),
      exposure: clamp(next.exposure ?? this.renderSettings.exposure, 0, 8),
      gamma: clamp(next.gamma ?? this.renderSettings.gamma, 0.2, 5),
      brightness: clamp(next.brightness ?? this.renderSettings.brightness, 0, 5),
      contrast: clamp(next.contrast ?? this.renderSettings.contrast, 0, 5),
      saturation: clamp(next.saturation ?? this.renderSettings.saturation, 0, 5)
    };

    if (
      updated.interactionResolutionScale === this.renderSettings.interactionResolutionScale &&
      updated.maxSubframes === this.renderSettings.maxSubframes &&
      updated.tileCount === this.renderSettings.tileCount &&
      updated.tilesPerFrame === this.renderSettings.tilesPerFrame &&
      updated.toneMapping === this.renderSettings.toneMapping &&
      updated.exposure === this.renderSettings.exposure &&
      updated.gamma === this.renderSettings.gamma &&
      updated.brightness === this.renderSettings.brightness &&
      updated.contrast === this.renderSettings.contrast &&
      updated.saturation === this.renderSettings.saturation
    ) {
      return;
    }

    this.renderSettings = updated;
    this.markDirty();
  }

  updateUniformValues(values: Record<string, UniformValue>): void {
    if (this.sceneState === null) {
      return;
    }
    this.sceneState.uniformValues = { ...values };
    if (this.renderSettings.tileCount > 1) {
      this.notifyInteractionWithoutReset();
    } else {
      this.markDirty();
    }
  }

  updateIntegratorOptions(options: IntegratorOptionValues): void {
    if (this.sceneState === null) {
      return;
    }
    this.sceneState.integratorOptions = { ...options };
    if (this.renderSettings.tileCount > 1) {
      this.notifyInteractionWithoutReset();
    } else {
      this.markDirty();
    }
  }

  updateSlicePlaneLockFrame(frame: SlicePlaneLockFrame | null): void {
    this.slicePlaneLockFrameExternal =
      frame === null
        ? null
        : {
            origin: [...frame.origin],
            normal: [...frame.normal]
          };
    if (this.renderSettings.tileCount > 1) {
      this.notifyInteractionWithoutReset();
    } else {
      this.markDirty();
    }
  }

  setCamera(camera: CameraState): void {
    this.camera = {
      eye: [...camera.eye],
      target: [...camera.target],
      up: [...camera.up],
      fov: camera.fov
    };
    if (this.renderSettings.tileCount > 1) {
      this.notifyInteractionWithoutReset();
    } else {
      this.notifyInteraction();
    }
  }

  notifyInteraction(): void {
    this.lastInteractionMs = performance.now();
    this.markDirty();
  }

  private notifyInteractionWithoutReset(): void {
    this.lastInteractionMs = performance.now();
    if (this.renderSettings.maxSubframes > 0 && this.subframe >= this.renderSettings.maxSubframes) {
      this.subframe = 0;
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  setDisplaySize(width: number, height: number, dpr: number): void {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    const nextDpr = Math.max(1, dpr);

    if (
      this.currentWidth === nextWidth &&
      this.currentHeight === nextHeight &&
      Math.abs(this.dpr - nextDpr) < 1e-6
    ) {
      return;
    }

    this.currentWidth = nextWidth;
    this.currentHeight = nextHeight;
    this.dpr = nextDpr;

    const bufferWidth = Math.max(1, Math.floor(this.currentWidth * this.dpr));
    const bufferHeight = Math.max(1, Math.floor(this.currentHeight * this.dpr));
    if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
      this.canvas.width = bufferWidth;
      this.canvas.height = bufferHeight;
      console.info(`[renderer] Canvas buffer resized to ${bufferWidth}x${bufferHeight}.`);
    }

    this.markDirty();
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  destroy(): void {
    this.stop();

    if (this.sceneProgram !== null) {
      this.gl.deleteProgram(this.sceneProgram);
      this.sceneProgram = null;
    }
    if (this.focusProbeProgram !== null) {
      this.gl.deleteProgram(this.focusProbeProgram);
      this.focusProbeProgram = null;
    }
    this.gl.deleteProgram(this.displayProgram);

    if (this.readTarget !== null) {
      deleteRenderTarget(this.gl, this.readTarget);
      this.readTarget = null;
    }
    if (this.writeTarget !== null) {
      deleteRenderTarget(this.gl, this.writeTarget);
      this.writeTarget = null;
    }
    if (this.focusProbeTarget !== null) {
      deleteRenderTarget(this.gl, this.focusProbeTarget);
      this.focusProbeTarget = null;
    }

    console.info("[renderer] Destroyed WebGL resources.");
  }

  sampleFocusDistance(focusUv: [number, number]): number | null {
    if (this.sceneState === null || this.focusProbeProgram === null) {
      return null;
    }

    if (this.focusProbeTarget === null) {
      this.focusProbeTarget = createRenderTarget(this.gl, 1, 1);
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.focusProbeTarget.framebuffer);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.focusProbeProgram);

    this.setVec3Uniform(this.focusProbeProgram, "uEye", this.camera.eye);
    this.setVec3Uniform(this.focusProbeProgram, "uTarget", this.camera.target);
    this.setVec3Uniform(this.focusProbeProgram, "uUp", this.camera.up);
    this.setFloatUniform(this.focusProbeProgram, "uFov", this.camera.fov);
    this.setVec2Uniform(this.focusProbeProgram, "uFocusUv", [clamp(focusUv[0], 0, 1), clamp(focusUv[1], 0, 1)]);
    this.setVec2Uniform(this.focusProbeProgram, "uViewportSize", [
      Math.max(1, this.currentWidth),
      Math.max(1, this.currentHeight)
    ]);
    this.setFloatUniform(this.focusProbeProgram, "uDetailExp", this.getIntegratorOptionValue("detailExp", -2.3));
    this.setIntUniform(this.focusProbeProgram, "uMaxRaySteps", Math.trunc(this.getIntegratorOptionValue("maxRaySteps", 192)));
    this.setFloatUniform(this.focusProbeProgram, "uMaxDistance", this.getIntegratorOptionValue("maxDistance", 1200));
    this.setFloatUniform(this.focusProbeProgram, "uFudgeFactor", this.getIntegratorOptionValue("fudgeFactor", 1));
    this.setIntUniform(
      this.focusProbeProgram,
      "uIntegrator_slicePlaneEnabled",
      Math.trunc(this.getIntegratorOptionValue("slicePlaneEnabled", 0))
    );
    this.setIntUniform(
      this.focusProbeProgram,
      "uIntegrator_slicePlaneKeepFarSide",
      Math.trunc(this.getIntegratorOptionValue("slicePlaneKeepFarSide", 1))
    );
    this.uploadResolvedSlicePlaneUniforms(this.focusProbeProgram);

    this.uploadSceneUniformValues(this.focusProbeProgram);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.focusProbeReadback);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const value = this.focusProbeReadback[0];
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return value;
  }

  async renderStill(options: RenderStillFrameOptions): Promise<void> {
    if (this.running) {
      throw new Error("Offline export requires a renderer instance that is not running.");
    }
    if (this.sceneProgram === null || this.sceneState === null) {
      throw new Error("Renderer scene is not initialized.");
    }

    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    const targetSubframes = Math.max(1, Math.round(options.subframes));
    const timeMs = (options.timeSeconds ?? 0) * 1000;

    this.setRenderSettings({
      interactionResolutionScale: 1,
      maxSubframes: targetSubframes
    });
    this.setDisplaySize(width, height, 1);
    this.lastInteractionMs = Number.NEGATIVE_INFINITY;
    this.wasInteracting = false;
    this.markDirty();

    let iterations = 0;
    while (true) {
      if (options.signal?.aborted === true) {
        throw createExportAbortError();
      }

      this.render(timeMs);
      options.onProgress?.(this.getExportProgress(targetSubframes));

      if (this.subframe >= targetSubframes) {
        break;
      }

      iterations += 1;
      const shouldYield = options.onProgress !== undefined ? true : (iterations & 1) === 0;
      if (shouldYield) {
        await waitForNextAnimationFrame();
      }
    }

    options.onProgress?.({
      progress: 1,
      subframe: targetSubframes,
      tileCursor: 0,
      totalSubframes: targetSubframes,
      tileCount: this.renderSettings.tileCount
    });
  }

  async renderStillToPngBlob(options: RenderStillPngOptions): Promise<Blob> {
    await this.renderStill(options);
    return await this.captureDisplayPngBlob();
  }

  setCameraRayViewportOverride(fullResolution: [number, number] | null, pixelOffset: [number, number] = [0, 0]): void {
    this.cameraRayResolutionOverride = fullResolution === null ? null : [fullResolution[0], fullResolution[1]];
    this.cameraRayPixelOffsetOverride = [pixelOffset[0], pixelOffset[1]];
    this.markDirty();
  }

  clearCameraRayViewportOverride(): void {
    this.cameraRayResolutionOverride = null;
    this.cameraRayPixelOffsetOverride = [0, 0];
    this.markDirty();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) {
      return;
    }

    this.render(now);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private render(now: number): void {
    if (this.sceneProgram === null || this.sceneState === null) {
      this.renderFallbackFrame();
      return;
    }

    const isInteracting = now - this.lastInteractionMs < INTERACTION_WINDOW_MS;
    if (this.wasInteracting && !isInteracting) {
      this.markDirty();
    }
    this.wasInteracting = isInteracting;

    const targetScale = isInteracting ? this.renderSettings.interactionResolutionScale : 1;
    if (Math.abs(targetScale - this.currentScale) > 0.001) {
      this.currentScale = targetScale;
      this.dirty = true;
    }

    const pixelWidth = Math.max(1, Math.floor(this.currentWidth * this.dpr * this.currentScale));
    const pixelHeight = Math.max(1, Math.floor(this.currentHeight * this.dpr * this.currentScale));

    this.ensureTargets(pixelWidth, pixelHeight);
    if (this.readTarget === null || this.writeTarget === null) {
      throw new Error("Render targets were not initialized.");
    }

    if (this.dirty) {
      this.subframe = 0;
      this.tileCursor = 0;

      if (this.renderSettings.tileCount > 1) {
        // Seed a complete frame first so tiled updates never start from a black buffer.
        this.renderScenePass(now, null);
        this.swapTargets();
        if (!isInteracting) {
          // At rest, treat the seeded frame as the first accumulation sample.
          this.subframe = 1;
        }
      } else {
        this.clearRenderTargets();
      }
      this.dirty = false;
    }

    const canAccumulate =
      this.renderSettings.maxSubframes === 0 || this.subframe < this.renderSettings.maxSubframes;
    if (canAccumulate) {
      const activeTileCount = this.renderSettings.tileCount;
      const activeTilesPerFrame = this.renderSettings.tilesPerFrame;

      if (isInteracting && activeTileCount > 1) {
        // Interaction preview mode: update only a subset of tiles and avoid full-buffer copies.
        const totalTiles = activeTileCount * activeTileCount;
        const passes = Math.min(activeTilesPerFrame, totalTiles);
        for (let i = 0; i < passes; i += 1) {
          const tileRect = this.getTileRect(
            this.tileCursor,
            activeTileCount,
            this.readTarget.width,
            this.readTarget.height
          );
          this.renderScenePassPreview(now, tileRect);
          this.tileCursor = (this.tileCursor + 1) % totalTiles;
        }
      } else if (activeTileCount <= 1) {
        this.renderScenePass(now, null);
        this.swapTargets();
        this.subframe += 1;
      } else {
        const totalTiles = activeTileCount * activeTileCount;
        const passes = activeTilesPerFrame;
        for (let i = 0; i < passes; i += 1) {
          const canContinue =
            this.renderSettings.maxSubframes === 0 || this.subframe < this.renderSettings.maxSubframes;
          if (!canContinue) {
            break;
          }

          this.copyReadToWrite();
          const tileRect = this.getTileRect(
            this.tileCursor,
            activeTileCount,
            this.writeTarget.width,
            this.writeTarget.height
          );
          this.renderScenePass(now, tileRect);
          this.swapTargets();

          this.tileCursor += 1;
          if (this.tileCursor >= totalTiles) {
            this.tileCursor = 0;
            this.subframe += 1;
          }
        }
      }
    }

    this.renderDisplayPass();
    this.updateStatus(now, pixelWidth, pixelHeight);
  }

  private getExportProgress(totalSubframes: number): RendererExportProgress {
    const tileCount = Math.max(1, Math.round(this.renderSettings.tileCount));
    const totalTiles = tileCount * tileCount;
    const frameProgress = tileCount > 1 ? this.subframe + this.tileCursor / totalTiles : this.subframe;
    const progress = totalSubframes <= 0 ? 1 : clamp(frameProgress / totalSubframes, 0, 1);
    return {
      progress,
      subframe: this.subframe,
      tileCursor: this.tileCursor,
      totalSubframes,
      tileCount
    };
  }

  private ensureTargets(width: number, height: number): void {
    if (
      this.readTarget !== null &&
      this.writeTarget !== null &&
      this.readTarget.width === width &&
      this.readTarget.height === height
    ) {
      return;
    }

    if (this.readTarget !== null) {
      deleteRenderTarget(this.gl, this.readTarget);
      this.readTarget = null;
    }
    if (this.writeTarget !== null) {
      deleteRenderTarget(this.gl, this.writeTarget);
      this.writeTarget = null;
    }

    this.readTarget = createRenderTarget(this.gl, width, height);
    this.writeTarget = createRenderTarget(this.gl, width, height);

    console.info(`[renderer] Allocated accumulation buffers ${width}x${height} (scale=${this.currentScale.toFixed(2)}).`);
  }

  private clearRenderTargets(): void {
    if (this.readTarget === null || this.writeTarget === null) {
      return;
    }

    const clearTarget = (target: RenderTarget): void => {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
      this.gl.viewport(0, 0, target.width, target.height);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    };

    clearTarget(this.readTarget);
    clearTarget(this.writeTarget);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  private renderScenePass(now: number, tileRect: TileRect | null): void {
    if (this.sceneProgram === null || this.sceneState === null || this.readTarget === null || this.writeTarget === null) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.writeTarget.framebuffer);
    gl.viewport(0, 0, this.writeTarget.width, this.writeTarget.height);
    if (tileRect !== null) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(tileRect.x, tileRect.y, tileRect.width, tileRect.height);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.useProgram(this.sceneProgram);

    this.setVec2Uniform(
      this.sceneProgram,
      "uResolution",
      this.cameraRayResolutionOverride ?? [this.writeTarget.width, this.writeTarget.height]
    );
    this.setVec2Uniform(this.sceneProgram, "uPixelOffset", this.cameraRayPixelOffsetOverride);
    this.setFloatUniform(this.sceneProgram, "uTime", now * 0.001);
    this.setIntUniform(this.sceneProgram, "uSubframe", this.subframe);
    this.setIntUniform(this.sceneProgram, "uFrameIndex", this.nextFrameSeed());
    this.setBoolUniform(this.sceneProgram, "uUseBackbuffer", this.subframe > 0 ? 1 : 0);

    this.setVec3Uniform(this.sceneProgram, "uEye", this.camera.eye);
    this.setVec3Uniform(this.sceneProgram, "uTarget", this.camera.target);
    this.setVec3Uniform(this.sceneProgram, "uUp", this.camera.up);
    this.setFloatUniform(this.sceneProgram, "uFov", this.camera.fov);
    this.setFloatUniform(this.sceneProgram, "uLensAperture", this.getIntegratorOptionValue("aperture", 0));
    this.setFloatUniform(
      this.sceneProgram,
      "uLensFocalDistance",
      this.getIntegratorOptionValue("focalDistance", this.getTargetDistance())
    );
    this.setFloatUniform(this.sceneProgram, "uAAStrength", this.getIntegratorOptionValue("aaJitter", 1));
    this.uploadResolvedSlicePlaneUniforms(this.sceneProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.readTarget.texture);
    this.setIntUniform(this.sceneProgram, "uBackbuffer", 0);

    this.uploadSceneUniformValues(this.sceneProgram);
    this.uploadIntegratorUniformValues(this.sceneProgram);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private renderScenePassPreview(now: number, tileRect: TileRect): void {
    if (this.sceneProgram === null || this.sceneState === null || this.readTarget === null || this.writeTarget === null) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.readTarget.framebuffer);
    gl.viewport(0, 0, this.readTarget.width, this.readTarget.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(tileRect.x, tileRect.y, tileRect.width, tileRect.height);
    gl.useProgram(this.sceneProgram);

    this.setVec2Uniform(
      this.sceneProgram,
      "uResolution",
      this.cameraRayResolutionOverride ?? [this.readTarget.width, this.readTarget.height]
    );
    this.setVec2Uniform(this.sceneProgram, "uPixelOffset", this.cameraRayPixelOffsetOverride);
    this.setFloatUniform(this.sceneProgram, "uTime", now * 0.001);
    this.setIntUniform(this.sceneProgram, "uSubframe", 0);
    this.setIntUniform(this.sceneProgram, "uFrameIndex", this.nextFrameSeed());
    this.setBoolUniform(this.sceneProgram, "uUseBackbuffer", 0);

    this.setVec3Uniform(this.sceneProgram, "uEye", this.camera.eye);
    this.setVec3Uniform(this.sceneProgram, "uTarget", this.camera.target);
    this.setVec3Uniform(this.sceneProgram, "uUp", this.camera.up);
    this.setFloatUniform(this.sceneProgram, "uFov", this.camera.fov);
    this.setFloatUniform(this.sceneProgram, "uLensAperture", this.getIntegratorOptionValue("aperture", 0));
    this.setFloatUniform(
      this.sceneProgram,
      "uLensFocalDistance",
      this.getIntegratorOptionValue("focalDistance", this.getTargetDistance())
    );
    this.setFloatUniform(this.sceneProgram, "uAAStrength", this.getIntegratorOptionValue("aaJitter", 1));
    this.uploadResolvedSlicePlaneUniforms(this.sceneProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.writeTarget.texture);
    this.setIntUniform(this.sceneProgram, "uBackbuffer", 0);

    this.uploadSceneUniformValues(this.sceneProgram);
    this.uploadIntegratorUniformValues(this.sceneProgram);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private renderDisplayPass(): void {
    if (this.readTarget === null) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.currentWidth * this.dpr, this.currentHeight * this.dpr);
    gl.useProgram(this.displayProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.readTarget.texture);

    this.setIntUniform(this.displayProgram, "uFrontbuffer", 0);
    this.setFloatUniform(this.displayProgram, "uGamma", this.renderSettings.gamma);
    this.setFloatUniform(this.displayProgram, "uExposure", this.renderSettings.exposure);
    this.setIntUniform(this.displayProgram, "uToneMapping", this.renderSettings.toneMapping);
    this.setFloatUniform(this.displayProgram, "uBrightness", this.renderSettings.brightness);
    this.setFloatUniform(this.displayProgram, "uContrast", this.renderSettings.contrast);
    this.setFloatUniform(this.displayProgram, "uSaturation", this.renderSettings.saturation);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private swapTargets(): void {
    if (this.readTarget === null || this.writeTarget === null) {
      return;
    }
    const temp = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = temp;
  }

  private copyReadToWrite(): void {
    if (this.readTarget === null || this.writeTarget === null) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readTarget.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.writeTarget.framebuffer);
    gl.blitFramebuffer(
      0,
      0,
      this.readTarget.width,
      this.readTarget.height,
      0,
      0,
      this.writeTarget.width,
      this.writeTarget.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  private getTileRect(index: number, tileCount: number, width: number, height: number): TileRect {
    const tileX = index % tileCount;
    const tileY = Math.floor(index / tileCount);
    const tileWidth = Math.ceil(width / tileCount);
    const tileHeight = Math.ceil(height / tileCount);

    const x = tileX * tileWidth;
    const y = tileY * tileHeight;
    const tileWidthClamped = Math.max(1, Math.min(tileWidth, width - x));
    const tileHeightClamped = Math.max(1, Math.min(tileHeight, height - y));

    return {
      x,
      y,
      width: tileWidthClamped,
      height: tileHeightClamped
    };
  }

  private uploadSceneUniformValues(program: WebGLProgram): void {
    if (this.sceneState === null) {
      return;
    }

    for (const def of this.sceneState.uniformDefinitions) {
      const value = this.sceneState.uniformValues[def.name];
      if (value === undefined) {
        continue;
      }
      this.uploadUniformToProgram(program, def.type, def.name, value);
    }
  }

  private uploadIntegratorUniformValues(program: WebGLProgram): void {
    if (this.sceneState === null) {
      return;
    }

    for (const option of this.sceneState.integrator.options) {
      const value = this.sceneState.integratorOptions[option.key];
      const uniformName = `uIntegrator_${option.key}`;
      const isInt = option.step === 1 && Number.isInteger(option.defaultValue);
      if (isInt) {
        this.setIntUniform(program, uniformName, Math.trunc(value));
      } else {
        this.setFloatUniform(program, uniformName, value);
      }
    }
  }

  private getCameraForwardDirection(): Vec3Tuple {
    const dx = this.camera.target[0] - this.camera.eye[0];
    const dy = this.camera.target[1] - this.camera.eye[1];
    const dz = this.camera.target[2] - this.camera.eye[2];
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len <= 1.0e-6) {
      return [0, 0, 1];
    }
    return [dx / len, dy / len, dz / len];
  }

  private syncSlicePlaneLockState(): void {
    const lockEnabled = this.getIntegratorOptionValue("slicePlaneLock", 0) >= 0.5;

    if (lockEnabled) {
      if (!this.slicePlaneLockWasEnabled || this.slicePlaneLockAnchorOrigin === null || this.slicePlaneLockAnchorNormal === null) {
        this.slicePlaneLockAnchorOrigin = [...this.camera.eye];
        this.slicePlaneLockAnchorNormal = this.getCameraForwardDirection();
        console.info("[renderer] Captured locked slice plane frame.");
      }
    } else if (this.slicePlaneLockWasEnabled) {
      console.info("[renderer] Released locked slice plane frame.");
    }

    this.slicePlaneLockWasEnabled = lockEnabled;
  }

  private resolveSlicePlanePointAndNormal(): { point: Vec3Tuple; normal: Vec3Tuple } {
    const lockEnabled = this.getIntegratorOptionValue("slicePlaneLock", 0) >= 0.5;
    const distance = this.getIntegratorOptionValue("slicePlaneDistance", 2);

    if (lockEnabled && this.slicePlaneLockFrameExternal !== null) {
      const origin = this.slicePlaneLockFrameExternal.origin;
      const normal = this.slicePlaneLockFrameExternal.normal;
      const point: Vec3Tuple = [
        origin[0] + normal[0] * distance,
        origin[1] + normal[1] * distance,
        origin[2] + normal[2] * distance
      ];
      return { point, normal: [...normal] };
    }

    this.syncSlicePlaneLockState();

    const origin: Vec3Tuple =
      lockEnabled && this.slicePlaneLockAnchorOrigin !== null ? this.slicePlaneLockAnchorOrigin : [...this.camera.eye];
    const normal: Vec3Tuple =
      lockEnabled && this.slicePlaneLockAnchorNormal !== null ? this.slicePlaneLockAnchorNormal : this.getCameraForwardDirection();

    const point: Vec3Tuple = [
      origin[0] + normal[0] * distance,
      origin[1] + normal[1] * distance,
      origin[2] + normal[2] * distance
    ];

    return { point, normal };
  }

  private uploadResolvedSlicePlaneUniforms(program: WebGLProgram): void {
    const resolved = this.resolveSlicePlanePointAndNormal();
    this.setVec3Uniform(program, "uSlicePlaneResolvedPoint", resolved.point);
    this.setVec3Uniform(program, "uSlicePlaneResolvedNormal", resolved.normal);
  }

  private uploadUniformToProgram(
    program: WebGLProgram,
    type: UniformDefinition["type"],
    name: string,
    value: UniformValue
  ): void {
    switch (type) {
      case "float":
        this.setFloatUniform(program, name, Number(value));
        return;
      case "int":
        this.setIntUniform(program, name, Math.trunc(Number(value)));
        return;
      case "bool":
        this.setBoolUniform(program, name, value === true ? 1 : 0);
        return;
      case "vec2": {
        if (!Array.isArray(value) || value.length !== 2) {
          throw new Error(`Uniform ${name} expected vec2 value.`);
        }
        this.setVec2Uniform(program, name, [value[0], value[1]]);
        return;
      }
      case "vec3": {
        if (!Array.isArray(value) || value.length !== 3) {
          throw new Error(`Uniform ${name} expected vec3 value.`);
        }
        this.setVec3Uniform(program, name, [value[0], value[1], value[2]]);
        return;
      }
      case "vec4": {
        if (!Array.isArray(value) || value.length !== 4) {
          throw new Error(`Uniform ${name} expected vec4 value.`);
        }
        this.setVec4Uniform(program, name, [value[0], value[1], value[2], value[3]]);
        return;
      }
      default:
        return;
    }
  }

  private getIntegratorOptionValue(key: string, fallback: number): number {
    if (this.sceneState === null) {
      return fallback;
    }

    const option = this.sceneState.integrator.options.find((entry) => entry.key === key);
    if (option === undefined) {
      return fallback;
    }

    const raw = this.sceneState.integratorOptions[key];
    return Number.isFinite(raw) ? raw : option.defaultValue;
  }

  private getTargetDistance(): number {
    const dx = this.camera.target[0] - this.camera.eye[0];
    const dy = this.camera.target[1] - this.camera.eye[1];
    const dz = this.camera.target[2] - this.camera.eye[2];
    return Math.max(Math.hypot(dx, dy, dz), 1.0e-4);
  }

  private nextFrameSeed(): number {
    const value = this.frameSeed;
    this.frameSeed = this.frameSeed >= 2147483646 ? 1 : this.frameSeed + 1;
    return value;
  }

  private renderFallbackFrame(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.currentWidth * this.dpr, this.currentHeight * this.dpr);
    gl.clearColor(0.06, 0.06, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private updateStatus(now: number, width: number, height: number): void {
    this.frameCounter += 1;

    if (now - this.lastStatusMs < STATUS_INTERVAL_MS) {
      return;
    }

    const elapsedSec = Math.max((now - this.frameCounterStart) / 1000, 1e-3);
    const fps = this.frameCounter / elapsedSec;

    this.onStatus({
      fps,
      subframe: this.subframe,
      scale: this.currentScale,
      resolution: [width, height],
      maxSubframes: this.renderSettings.maxSubframes,
      tileCount: this.renderSettings.tileCount,
      tileCursor: this.tileCursor
    });

    this.lastStatusMs = now;
    this.frameCounter = 0;
    this.frameCounterStart = now;
  }

  private setFloatUniform(program: WebGLProgram, name: string, value: number): void {
    const location = this.gl.getUniformLocation(program, name);
    if (location === null) {
      return;
    }
    this.gl.uniform1f(location, value);
  }

  private setIntUniform(program: WebGLProgram, name: string, value: number): void {
    const location = this.gl.getUniformLocation(program, name);
    if (location === null) {
      return;
    }
    this.gl.uniform1i(location, value);
  }

  private setBoolUniform(program: WebGLProgram, name: string, value: 0 | 1): void {
    this.setIntUniform(program, name, value);
  }

  private setVec2Uniform(program: WebGLProgram, name: string, value: [number, number]): void {
    const location = this.gl.getUniformLocation(program, name);
    if (location === null) {
      return;
    }
    this.gl.uniform2f(location, value[0], value[1]);
  }

  private setVec3Uniform(program: WebGLProgram, name: string, value: [number, number, number]): void {
    const location = this.gl.getUniformLocation(program, name);
    if (location === null) {
      return;
    }
    this.gl.uniform3f(location, value[0], value[1], value[2]);
  }

  private setVec4Uniform(
    program: WebGLProgram,
    name: string,
    value: [number, number, number, number]
  ): void {
    const location = this.gl.getUniformLocation(program, name);
    if (location === null) {
      return;
    }
    this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
  }

  async captureDisplayPngBlob(): Promise<Blob> {
    const image = this.captureDisplayImageData();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = image.width;
    exportCanvas.height = image.height;
    const ctx = exportCanvas.getContext("2d");
    if (ctx === null) {
      throw new Error("2D canvas context is unavailable for PNG export.");
    }
    ctx.putImageData(image, 0, 0);
    return await canvasToPngBlob(exportCanvas);
  }

  captureDisplayImageData(): ImageData {
    const width = Math.max(1, Math.floor(this.canvas.width));
    const height = Math.max(1, Math.floor(this.canvas.height));
    const gl = this.gl;

    // Read back the post-processed display buffer synchronously. This avoids black PNG exports
    // caused by async canvas.toBlob() snapshots on WebGL canvases with preserveDrawingBuffer=false.
    const raw = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);

    const flipped = new Uint8ClampedArray(raw.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y += 1) {
      const srcOffset = (height - 1 - y) * rowBytes;
      const dstOffset = y * rowBytes;
      flipped.set(raw.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }

    return new ImageData(flipped, width, height);
  }
}

function extractAngleInfo(rendererString: string): string | null {
  const angleIndex = rendererString.indexOf("ANGLE");
  if (angleIndex < 0) {
    return null;
  }
  return rendererString.slice(angleIndex).trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function waitForNextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      window.setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => resolve());
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("Canvas PNG export failed."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function createExportAbortError(): Error {
  const error = new Error("Export cancelled.");
  error.name = "AbortError";
  return error;
}
