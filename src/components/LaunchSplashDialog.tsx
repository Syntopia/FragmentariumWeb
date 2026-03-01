import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

interface LaunchSplashDialogProps {
  open: boolean;
  versionLabel: string;
  onClose: () => void;
}

type SplashPhase = "initializing" | "checking-gpu" | "ready";

interface GpuCheckSummary {
  ok: boolean;
  message: string;
}

const SPLASH_INIT_DELAY_MS = 1100;
const SPLASH_GPU_CHECK_MIN_DELAY_MS = 1100;

const SPLASH_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const SPLASH_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_pointer;

#define ITERATIONS 12
#define MAX_STEPS 30
#define MIN_DIST 0.001
#define NORMAL_DIST 0.0002
#define SCALE 2.0
#define FIELD_OF_VIEW 1.0
#define JITTER 0.05
#define FUDGE 1.0
#define PI 3.14159265359
#define AMBIENT 0.28452
#define DIFFUSE 0.57378
#define SPECULAR 0.07272
#define LIGHT_DIR vec3(1.0, 1.0, -0.65048)
#define LIGHT_COLOR vec3(1.0, 0.666667, 0.0)
#define LIGHT_DIR2 vec3(1.0, -0.62886, 1.0)
#define LIGHT_COLOR2 vec3(0.596078, 0.635294, 1.0)

vec2 rotate2d(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}

float trap(vec3 p, float t) {
  return length(p.x - 0.5 - 0.5 * sin(t / 10.0));
}

float de(vec3 z, float t, vec3 offset) {
  z = abs(1.0 - mod(z, 2.0));
  float d = 1000.0;
  float scaleAccum = 1.0;
  for (int n = 0; n < ITERATIONS; n++) {
    z.xz = rotate2d(z.xz, t / 18.0);
    if (z.x + z.y < 0.0) z.xy = -z.yx;
    z = abs(z);
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    z = abs(z);
    if (z.x - z.y < 0.0) z.xy = z.yx;
    z = abs(z);
    if (z.x - z.z < 0.0) z.xz = z.zx;
    z = z * SCALE - offset * (SCALE - 1.0);
    z.yz = rotate2d(z.yz, -t / 18.0);
    scaleAccum *= SCALE;
    d = min(d, trap(z, t) / scaleAccum);
  }
  return d;
}

vec3 calcNormal(vec3 p, float t, vec3 offset) {
  vec3 e = vec3(0.0, NORMAL_DIST, 0.0);
  return normalize(vec3(
    de(p + e.yxx, t, offset) - de(p - e.yxx, t, offset),
    de(p + e.xyx, t, offset) - de(p - e.xyx, t, offset),
    de(p + e.xxy, t, offset) - de(p - e.xxy, t, offset)
  ));
}

vec3 toneMap(vec3 c) {
  c = pow(c, vec3(2.0));
  vec3 x = max(vec3(0.0), c - vec3(0.004));
  c = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
  return c;
}

float rand(vec2 co) {
  return fract(cos(dot(co, vec2(4.898, 7.23))) * 23421.631);
}

vec3 fakeEnv(vec3 dir) {
  float y = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.22, 0.27, 0.38), vec3(1.05, 1.08, 1.12), smoothstep(0.12, 1.0, y));
  float sunDot = max(0.0, dot(normalize(vec3(0.12, 0.78, 0.60)), normalize(dir)));
  float sunCore = pow(sunDot, 128.0);
  float sunBloom = pow(sunDot, 18.0);
  float horizon = exp(-abs(dir.y) * 5.8);
  return
    sky +
    vec3(1.0, 1.0, 1.0) * sunCore * 3.2 +
    vec3(1.0, 0.98, 0.94) * sunBloom * 1.35 +
    vec3(0.36, 0.37, 0.40) * horizon * 0.24;
}

vec3 getLight(vec3 color, vec3 normal, vec3 dir) {
  vec3 lightDir = normalize(LIGHT_DIR);
  float specular = pow(max(0.0, dot(lightDir, -reflect(lightDir, normal))), 20.0);
  float diffuse = max(0.0, dot(-normal, lightDir));

  vec3 lightDir2 = normalize(LIGHT_DIR2);
  float specular2 = pow(max(0.0, dot(lightDir2, -reflect(lightDir2, normal))), 20.0);
  float diffuse2 = max(0.0, dot(-normal, lightDir2));
  float fresnel = pow(clamp(1.0 - max(0.0, dot(normalize(-dir), normal)), 0.0, 1.0), 3.5);
  vec3 envSpec = fakeEnv(reflect(dir, normal)) * SPECULAR * (2.4 + fresnel * 2.2);

  return
    envSpec +
    (SPECULAR * specular * 1.15) * LIGHT_COLOR + (diffuse * DIFFUSE) * (LIGHT_COLOR * color) +
    (SPECULAR * specular2 * 1.15) * LIGHT_COLOR2 + (diffuse2 * DIFFUSE) * (LIGHT_COLOR2 * color);
}

vec4 rayMarch(vec3 from, vec3 dir, vec2 pix, float t, vec3 offset) {
  float totalDistance = JITTER * rand(pix + vec2(t));
  float distance = 0.0;
  int steps = 0;
  vec3 pos = from;
  for (int i = 0; i < MAX_STEPS; i++) {
    pos = from + totalDistance * dir;
    distance = de(pos, t, offset) * FUDGE;
    totalDistance += distance;
    if (distance < MIN_DIST) {
      break;
    }
    steps = i;
  }

  float smoothStep = float(steps) + distance / MIN_DIST;
  float ao = 1.0 - smoothStep / float(MAX_STEPS);
  vec3 normal = calcNormal(pos - dir * NORMAL_DIST * 3.0, t, offset);
  vec3 color = mix(vec3(1.0), abs(normal), 0.3);
  vec3 light = getLight(color, normal, dir);
  return vec4(toneMap((color * AMBIENT + light) * ao), 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  float t = u_time + 38.0;
  vec3 offset = vec3(1.0 + 0.2 * cos(t / 5.7), 0.3 + 0.1 * cos(t / 1.7), 1.0).xzy;
  float dragYaw = u_pointer.x * PI * 0.55;
  float dragPitch = u_pointer.y * PI * 0.42;

  float angle = t / 5.0 + dragYaw;
  vec3 camPos = 0.5 * t * vec3(1.0, 0.0, 0.0);
  camPos += vec3(0.0, 0.0, dragPitch * 1.1);
  vec3 target = camPos + vec3(1.0, 0.5 * cos(t), 0.5 * sin(0.4 * t));
  vec3 camUp = vec3(0.0, cos(angle), sin(angle));

  vec3 camDir = normalize(target - camPos);
  camUp = normalize(camUp - dot(camDir, camUp) * camDir);
  vec3 camRight = normalize(cross(camDir, camUp));

  vec2 coord = -1.0 + 2.0 * fragCoord / u_resolution.xy;
  coord.x *= u_resolution.x / max(1.0, u_resolution.y);
  vec3 rayDir = normalize(camDir + (coord.x * camRight + coord.y * camUp) * FIELD_OF_VIEW);
  fragColor = rayMarch(camPos, rayDir, fragCoord, t, offset);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error(`[splash] Failed to create ${label} shader.`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown compile error.";
    gl.deleteShader(shader);
    throw new Error(`[splash] ${label} shader compile failed: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, SPLASH_VERTEX_SHADER_SOURCE, "vertex");
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, SPLASH_FRAGMENT_SHADER_SOURCE, "fragment");
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("[splash] Failed to create WebGL program.");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown link error.";
    gl.deleteProgram(program);
    throw new Error(`[splash] Program link failed: ${log}`);
  }
  return program;
}

function runGpuRequirementCheck(gl: WebGL2RenderingContext): GpuCheckSummary {
  const missing: string[] = [];
  if (gl.getExtension("EXT_color_buffer_float") === null) {
    missing.push("EXT_color_buffer_float");
  }
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required capability: ${missing.join(", ")}`
    };
  }
  return { ok: true, message: "GPU requirements OK." };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function LaunchSplashDialog(props: LaunchSplashDialogProps): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<[number, number]>([0, 0]);
  const [phase, setPhase] = useState<SplashPhase>("initializing");
  const [gpuSummary, setGpuSummary] = useState<GpuCheckSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const subtitle = useMemo(() => {
    if (phase === "initializing") {
      return "Initializing GUI...";
    }
    if (phase === "checking-gpu") {
      return "Checking GPU requirements...";
    }
    return "Click to start";
  }, [phase]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    setPhase("initializing");
    setGpuSummary(null);
    setErrorMessage(null);
    pointerRef.current = [0, 0];

    let cancelled = false;
    let frameHandle = 0;
    const timers: number[] = [];
    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let quadBuffer: WebGLBuffer | null = null;
    let uniformTime: WebGLUniformLocation | null = null;
    let uniformResolution: WebGLUniformLocation | null = null;
    let uniformPointer: WebGLUniformLocation | null = null;
    const t0 = performance.now();

    const schedule = (callback: () => void, delayMs: number): void => {
      const timeoutId = window.setTimeout(() => {
        const index = timers.indexOf(timeoutId);
        if (index >= 0) {
          timers.splice(index, 1);
        }
        callback();
      }, delayMs);
      timers.push(timeoutId);
    };

    const renderFrame = (): void => {
      if (cancelled || gl === null || program === null || quadBuffer === null) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const targetHeight = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      if (uniformTime !== null) {
        gl.uniform1f(uniformTime, (performance.now() - t0) * 0.001);
      }
      if (uniformResolution !== null) {
        gl.uniform2f(uniformResolution, canvas.width, canvas.height);
      }
      if (uniformPointer !== null) {
        gl.uniform2f(uniformPointer, pointerRef.current[0], pointerRef.current[1]);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frameHandle = window.requestAnimationFrame(renderFrame);
    };

    try {
      const context = canvas.getContext("webgl2", {
        alpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false
      });
      if (context === null) {
        throw new Error("WebGL2 context unavailable.");
      }
      gl = context as WebGL2RenderingContext;
      program = createProgram(gl);
      quadBuffer = gl.createBuffer();
      if (quadBuffer === null) {
        throw new Error("Failed to allocate splash quad buffer.");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      uniformTime = gl.getUniformLocation(program, "u_time");
      uniformResolution = gl.getUniformLocation(program, "u_resolution");
      uniformPointer = gl.getUniformLocation(program, "u_pointer");

      console.info("[splash] Initializing GUI...");
      renderFrame();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[splash] Splash renderer init failed: ${message}`);
      setErrorMessage(message);
      setPhase("ready");
      setGpuSummary({
        ok: false,
        message: "Unable to initialize splash renderer."
      });
      return () => undefined;
    }

    schedule(() => {
      if (cancelled || gl === null) {
        return;
      }
      setPhase("checking-gpu");
      console.info("[splash] Checking GPU requirements...");
      const checkStart = performance.now();
      const summary = runGpuRequirementCheck(gl);
      const elapsed = performance.now() - checkStart;
      const remaining = Math.max(0, SPLASH_GPU_CHECK_MIN_DELAY_MS - elapsed);
      schedule(() => {
        if (cancelled) {
          return;
        }
        setGpuSummary(summary);
        setPhase("ready");
        console.info(`[splash] GPU check result: ${summary.message}`);
      }, remaining);
    }, SPLASH_INIT_DELAY_MS);

    return () => {
      cancelled = true;
      if (frameHandle !== 0) {
        window.cancelAnimationFrame(frameHandle);
      }
      for (const timerId of timers) {
        window.clearTimeout(timerId);
      }
      if (gl !== null) {
        if (quadBuffer !== null) {
          gl.deleteBuffer(quadBuffer);
        }
        if (program !== null) {
          gl.deleteProgram(program);
        }
      }
    };
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const updatePointerFromClientPosition = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number
  ): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) {
      return;
    }
    const normalizedX = (clientX - rect.left) / rect.width;
    const normalizedY = (clientY - rect.top) / rect.height;
    pointerRef.current = [
      clamp((normalizedX - 0.5) * 2, -1.0, 1.0),
      clamp((normalizedY - 0.5) * 2, -1.0, 1.0)
    ];
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    updatePointerFromClientPosition(event.currentTarget, event.clientX, event.clientY);
  };

  const onCanvasPointerLeave = (): void => {
    pointerRef.current = [0, 0];
  };

  const onShellClick = (): void => {
    if (phase !== "ready") {
      return;
    }
    props.onClose();
  };

  const onShellKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (phase !== "ready") {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    props.onClose();
  };

  return (
    <div className="splash-backdrop">
      <div className="splash-modal" role="dialog" aria-modal="true" aria-label="Launch splash">
        <div
          className={`splash-canvas-shell ${phase === "ready" ? "is-ready" : ""}`}
          role="button"
          aria-label="Start application"
          tabIndex={0}
          onClick={onShellClick}
          onKeyDown={onShellKeyDown}
        >
          <canvas
            ref={canvasRef}
            className="splash-canvas"
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={onCanvasPointerLeave}
          />
          <div className="splash-overlay-copy">
            <h1 className="splash-overlay-title">Fragmentarium Web</h1>
            <p className="splash-overlay-version">{props.versionLabel}</p>
            <p className={`splash-overlay-subtitle ${phase === "ready" ? "is-ready" : ""}`}>{subtitle}</p>
            {gpuSummary !== null ? (
              <p className={`splash-overlay-detail ${gpuSummary.ok ? "" : "is-warning"}`}>{gpuSummary.message}</p>
            ) : null}
          </div>
          {errorMessage !== null ? (
            <div className="splash-error">
              <strong>Startup Error</strong>
              <div>{errorMessage}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
