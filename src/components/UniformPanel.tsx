import type { UniformDefinition, UniformValue } from "../core/parser/types";

interface UniformPanelProps {
  uniforms: UniformDefinition[];
  values: Record<string, UniformValue>;
  onChange: (name: string, value: UniformValue) => void;
}

const vectorLabels = ["x", "y", "z", "w"];
const colorVectorLabels = ["r", "g", "b", "a"];

export function UniformPanel(props: UniformPanelProps): JSX.Element {
  return (
    <div className="uniform-panel">
      {props.uniforms.map((uniform) => (
        <UniformControl
          key={uniform.name}
          definition={uniform}
          value={props.values[uniform.name]}
          onChange={(value) => props.onChange(uniform.name, value)}
        />
      ))}
    </div>
  );
}

interface UniformControlProps {
  definition: UniformDefinition;
  value: UniformValue;
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
    return (
      <div className="uniform-row">
        <span className="uniform-label">{definition.name}</span>
        <div className="uniform-inputs">
          <input
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
  const axisLabels = definition.control === "color" ? colorVectorLabels : vectorLabels;
  const colorPreview = definition.control === "color" ? vectorToHexColor(vector) : null;

  return (
    <div className="uniform-vector">
      <div className="uniform-vector-header">
        <span className="uniform-label">{definition.name}</span>
        {colorPreview !== null ? (
          <input
            className="uniform-color-preview uniform-color-picker"
            type="color"
            aria-label={`${definition.name} color`}
            value={colorPreview}
            onChange={(event) => {
              props.onChange(applyHexColorToVector(vector, event.target.value));
            }}
          />
        ) : null}
      </div>
      {vector.map((entry, index) => (
        <div className="uniform-row compact" key={`${definition.name}-${axisLabels[index]}-${index}`}>
          <span className="uniform-axis">{axisLabels[index]}</span>
          <div className="uniform-inputs">
            <input
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function vectorToHexColor(vector: number[]): string {
  const toHex = (value: number): string => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");
  const r = toHex(vector[0] ?? 0);
  const g = toHex(vector[1] ?? 0);
  const b = toHex(vector[2] ?? 0);
  return `#${r}${g}${b}`;
}

function applyHexColorToVector(vector: number[], colorHex: string): number[] {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(colorHex);
  if (match === null) {
    return vector;
  }

  const rgb = match[1];
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;

  const next = [...vector];
  if (next.length > 0) {
    next[0] = r;
  }
  if (next.length > 1) {
    next[1] = g;
  }
  if (next.length > 2) {
    next[2] = b;
  }
  return next;
}
