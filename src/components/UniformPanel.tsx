import type { UniformDefinition, UniformValue } from "../core/parser/types";

interface UniformPanelProps {
  uniforms: UniformDefinition[];
  values: Record<string, UniformValue>;
  onChange: (name: string, value: UniformValue) => void;
}

const vectorLabels = ["X", "Y", "Z", "W"];

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
  const colorPreview = definition.control === "color" ? vectorToColor(vector) : null;

  return (
    <div className="uniform-vector">
      <div className="uniform-vector-header">
        <span className="uniform-label">{definition.name}</span>
        {colorPreview !== null ? <span className="uniform-color-preview" style={{ background: colorPreview }} /> : null}
      </div>
      {vector.map((entry, index) => (
        <div className="uniform-row compact" key={`${definition.name}-${vectorLabels[index]}`}>
          <span className="uniform-axis">{vectorLabels[index]}</span>
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

function vectorToColor(vector: number[]): string {
  const r = Math.max(0, Math.min(1, vector[0]));
  const g = Math.max(0, Math.min(1, vector[1]));
  const b = Math.max(0, Math.min(1, vector[2]));
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}
