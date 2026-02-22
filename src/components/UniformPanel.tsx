import type { UniformDefinition, UniformValue } from "../core/parser/types";
import { clamp, computeRgbIntensity, normalizeRgbByIntensity, parseHexColorToRgb, rgbToHexColor, scaleRgb, type Rgb } from "../utils/colorUi";

interface UniformPanelProps {
  uniforms: UniformDefinition[];
  values: Record<string, UniformValue>;
  baselineValues?: Record<string, UniformValue>;
  onChange: (name: string, value: UniformValue) => void;
}

const vectorLabels = ["x", "y", "z", "w"];

export function UniformPanel(props: UniformPanelProps): JSX.Element {
  return (
    <div className="uniform-panel">
      {props.uniforms.map((uniform) => (
        <UniformControl
          key={uniform.name}
          definition={uniform}
          value={props.values[uniform.name]}
          baselineValue={props.baselineValues?.[uniform.name]}
          onChange={(value) => props.onChange(uniform.name, value)}
        />
      ))}
    </div>
  );
}

interface UniformControlProps {
  definition: UniformDefinition;
  value: UniformValue;
  baselineValue?: UniformValue;
  onChange: (value: UniformValue) => void;
}

function UniformControl(props: UniformControlProps): JSX.Element {
  const { definition, value } = props;

  if (definition.type === "bool") {
    const boolValue = value === true;
    return (
      <label className="uniform-row uniform-bool">
        <span className="uniform-label">{definition.name}</span>
        <input
          type="checkbox"
          checked={boolValue}
          onChange={(event) => props.onChange(event.target.checked)}
        />
      </label>
    );
  }

  if (definition.type === "float" || definition.type === "int") {
    const numeric = Number(value);
    const step = definition.type === "int" ? 1 : inferStep(definition.min[0], definition.max[0]);
    const baselineNumeric =
      typeof props.baselineValue === "number" ? props.baselineValue : Number(definition.defaultValue);
    const sliderStateClass = isSliderAtDefault(numeric, baselineNumeric, step) ? "slider-default" : "slider-changed";
    return (
      <div className="uniform-row">
        <span className="uniform-label">{definition.name}</span>
        <div className="uniform-inputs">
          <input
            className={sliderStateClass}
            type="range"
            min={definition.min[0]}
            max={definition.max[0]}
            step={step}
            value={numeric}
            onChange={(event) => {
              const next = Number(event.target.value);
              props.onChange(definition.type === "int" ? Math.round(next) : next);
            }}
          />
          <input
            className="uniform-number"
            type="number"
            min={definition.min[0]}
            max={definition.max[0]}
            step={step}
            value={numeric}
            onChange={(event) => {
              const next = Number(event.target.value);
              props.onChange(definition.type === "int" ? Math.round(next) : next);
            }}
          />
        </div>
      </div>
    );
  }

  if (!Array.isArray(value)) {
    throw new Error(`Vector uniform '${definition.name}' is not an array.`);
  }

  const vector = [...value];
  const baselineVector =
    Array.isArray(props.baselineValue) && props.baselineValue.length >= vector.length
      ? props.baselineValue
      : Array.isArray(definition.defaultValue)
        ? definition.defaultValue
        : vector;
  if (definition.control === "color" && vector.length >= 3) {
    return (
      <ColorUniformControl
        definition={definition}
        vector={vector}
        baselineVector={baselineVector}
        onChange={(next) => props.onChange(next)}
      />
    );
  }

  const axisLabels = vectorLabels;

  return (
    <div className="uniform-vector">
      <div className="uniform-vector-header uniform-vector-header-centered">
        <span className="uniform-label">{definition.name}</span>
      </div>
      {vector.map((entry, index) => (
        <div className="uniform-row compact" key={`${definition.name}-${axisLabels[index]}-${index}`}>
          <span className="uniform-axis">{axisLabels[index]}</span>
          <div className="uniform-inputs">
            <input
              className={
                isSliderAtDefault(
                  entry,
                  Number(baselineVector[index] ?? entry),
                  inferStep(definition.min[index], definition.max[index])
                )
                  ? "slider-default"
                  : "slider-changed"
              }
              type="range"
              min={definition.min[index]}
              max={definition.max[index]}
              step={inferStep(definition.min[index], definition.max[index])}
              value={entry}
              onChange={(event) => {
                const next = Number(event.target.value);
                const updated = [...vector];
                updated[index] = next;
                props.onChange(updated);
              }}
            />
            <input
              className="uniform-number"
              type="number"
              min={definition.min[index]}
              max={definition.max[index]}
              step={inferStep(definition.min[index], definition.max[index])}
              value={entry}
              onChange={(event) => {
                const next = Number(event.target.value);
                const updated = [...vector];
                updated[index] = next;
                props.onChange(updated);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ColorUniformControlProps {
  definition: UniformDefinition;
  vector: number[];
  baselineVector: number[];
  onChange: (value: number[]) => void;
}

function ColorUniformControl(props: ColorUniformControlProps): JSX.Element {
  const { definition, vector, baselineVector } = props;
  const rgb: Rgb = [Number(vector[0] ?? 0), Number(vector[1] ?? 0), Number(vector[2] ?? 0)];
  const baselineRgb: Rgb = [
    Number(baselineVector[0] ?? rgb[0]),
    Number(baselineVector[1] ?? rgb[1]),
    Number(baselineVector[2] ?? rgb[2])
  ];
  const maxChannel = Math.max(definition.max[0] ?? 1, definition.max[1] ?? 1, definition.max[2] ?? 1, 1);
  const minChannel = Math.min(definition.min[0] ?? 0, definition.min[1] ?? 0, definition.min[2] ?? 0, 0);
  const showIntensity = maxChannel > 1.000001 || computeRgbIntensity(baselineRgb) > 1.000001;
  const intensity = computeRgbIntensity(rgb);
  const baselineIntensity = computeRgbIntensity(baselineRgb);
  const normalizedColor = normalizeRgbByIntensity(rgb, intensity);
  const colorHex = rgbToHexColor(normalizedColor);
  const intensityStep = inferStep(0, maxChannel);

  const alphaIndex = vector.length === 4 ? 3 : -1;
  const alphaValue = alphaIndex >= 0 ? Number(vector[alphaIndex]) : null;
  const alphaBaseline = alphaIndex >= 0 ? Number(baselineVector[alphaIndex] ?? alphaValue ?? 1) : null;
  const alphaMin = alphaIndex >= 0 ? definition.min[alphaIndex] : 0;
  const alphaMax = alphaIndex >= 0 ? definition.max[alphaIndex] : 1;

  return (
    <div className="uniform-vector">
      <div className="uniform-vector-header">
        <span className="uniform-label">{definition.name}</span>
        <input
          className="uniform-color-preview uniform-color-picker"
          type="color"
          aria-label={`${definition.name} color`}
          value={colorHex}
          onChange={(event) => {
            const parsed = parseHexColorToRgb(event.target.value);
            if (parsed === null) {
              return;
            }
            const scaled = showIntensity ? scaleRgb(parsed, intensity > 1e-9 ? intensity : 1) : parsed;
            const next = [...vector];
            next[0] = clamp(scaled[0], definition.min[0], definition.max[0]);
            next[1] = clamp(scaled[1], definition.min[1], definition.max[1]);
            next[2] = clamp(scaled[2], definition.min[2], definition.max[2]);
            props.onChange(next);
          }}
        />
      </div>

      {showIntensity ? (
        <div className="uniform-row compact" key={`${definition.name}-intensity`}>
          <span className="uniform-axis">i</span>
          <div className="uniform-inputs">
            <input
              className={isSliderAtDefault(intensity, baselineIntensity, intensityStep) ? "slider-default" : "slider-changed"}
              type="range"
              min={Math.max(0, minChannel)}
              max={maxChannel}
              step={intensityStep}
              value={intensity}
              onChange={(event) => {
                const nextIntensity = clamp(Number(event.target.value), Math.max(0, minChannel), maxChannel);
                const hue: Rgb = intensity > 1e-9 ? normalizeRgbByIntensity(rgb, intensity) : [1, 1, 1];
                const scaled = scaleRgb(hue, nextIntensity);
                const next = [...vector];
                next[0] = clamp(scaled[0], definition.min[0], definition.max[0]);
                next[1] = clamp(scaled[1], definition.min[1], definition.max[1]);
                next[2] = clamp(scaled[2], definition.min[2], definition.max[2]);
                props.onChange(next);
              }}
            />
            <input
              className="uniform-number"
              type="number"
              min={Math.max(0, minChannel)}
              max={maxChannel}
              step={intensityStep}
              value={intensity}
              onChange={(event) => {
                const nextIntensity = clamp(Number(event.target.value), Math.max(0, minChannel), maxChannel);
                const hue: Rgb = intensity > 1e-9 ? normalizeRgbByIntensity(rgb, intensity) : [1, 1, 1];
                const scaled = scaleRgb(hue, nextIntensity);
                const next = [...vector];
                next[0] = clamp(scaled[0], definition.min[0], definition.max[0]);
                next[1] = clamp(scaled[1], definition.min[1], definition.max[1]);
                next[2] = clamp(scaled[2], definition.min[2], definition.max[2]);
                props.onChange(next);
              }}
            />
          </div>
        </div>
      ) : null}

      {alphaIndex >= 0 && alphaValue !== null && alphaBaseline !== null ? (
        <div className="uniform-row compact" key={`${definition.name}-alpha`}>
          <span className="uniform-axis">a</span>
          <div className="uniform-inputs">
            <input
              className={
                isSliderAtDefault(alphaValue, alphaBaseline, inferStep(alphaMin, alphaMax))
                  ? "slider-default"
                  : "slider-changed"
              }
              type="range"
              min={alphaMin}
              max={alphaMax}
              step={inferStep(alphaMin, alphaMax)}
              value={alphaValue}
              onChange={(event) => {
                const next = [...vector];
                next[alphaIndex] = Number(event.target.value);
                props.onChange(next);
              }}
            />
            <input
              className="uniform-number"
              type="number"
              min={alphaMin}
              max={alphaMax}
              step={inferStep(alphaMin, alphaMax)}
              value={alphaValue}
              onChange={(event) => {
                const next = [...vector];
                next[alphaIndex] = Number(event.target.value);
                props.onChange(next);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function inferStep(min: number, max: number): number {
  const span = Math.abs(max - min);
  if (span > 100) {
    return 0.1;
  }
  if (span > 10) {
    return 0.01;
  }
  return 0.001;
}

function isSliderAtDefault(value: number, baseline: number, step: number): boolean {
  const tolerance = Math.max(Math.abs(step) * 0.5, 1.0e-9);
  return Math.abs(value - baseline) <= tolerance;
}
