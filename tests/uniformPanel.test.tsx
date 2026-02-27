import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { UniformPanel } from "../src/components/UniformPanel";
import type { UniformDefinition, UniformValue } from "../src/core/parser/types";

describe("UniformPanel", () => {
  test("emits changes for scalar slider and numeric input", () => {
    const uniforms: UniformDefinition[] = [
      {
        name: "Radius",
        type: "float",
        control: "slider",
        group: "Shape",
        min: [0],
        max: [5],
        defaultValue: 1,
        lockType: "notlocked",
        tooltip: ""
      }
    ];

    const values: Record<string, UniformValue> = { Radius: 1 };
    let lastValue: UniformValue | null = null;

    render(
      <UniformPanel
        uniforms={uniforms}
        values={values}
        onChange={(_name, value) => {
          lastValue = value;
        }}
      />
    );

    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "3.2" } });

    expect(lastValue).toBe(3.2);

    const numberInput = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "2.75" } });

    expect(lastValue).toBe(2.75);
  });

  test("emits checkbox updates", () => {
    const uniforms: UniformDefinition[] = [
      {
        name: "Julia",
        type: "bool",
        control: "checkbox",
        group: "Mandelbulb",
        min: [0],
        max: [1],
        defaultValue: false,
        lockType: "notlocked",
        tooltip: ""
      }
    ];

    const values: Record<string, UniformValue> = { Julia: false };
    let lastValue: UniformValue | null = null;

    render(
      <UniformPanel
        uniforms={uniforms}
        values={values}
        onChange={(_name, value) => {
          lastValue = value;
        }}
      />
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(lastValue).toBe(true);
  });

  test("renders a single color picker for color controls and applies updates", () => {
    const uniforms: UniformDefinition[] = [
      {
        name: "Tint",
        type: "vec3",
        control: "color",
        group: "Coloring",
        min: [0, 0, 0],
        max: [1, 1, 1],
        defaultValue: [0.1, 0.2, 0.3],
        lockType: "notlocked",
        tooltip: ""
      }
    ];

    const values: Record<string, UniformValue> = { Tint: [0.1, 0.2, 0.3] };
    let lastValue: UniformValue | null = null;

    const { container } = render(
      <UniformPanel
        uniforms={uniforms}
        values={values}
        onChange={(_name, value) => {
          lastValue = value;
        }}
      />
    );

    const axisLabels = [...container.querySelectorAll(".uniform-axis")].map((entry) => entry.textContent?.trim().toLowerCase());
    expect(axisLabels).toEqual([]);

    expect(screen.getByRole("button", { name: "Tint color" }).textContent).toMatch(/^#[0-9A-F]{6}$/);

    const colorPicker = container.querySelector('input[type="color"]') as HTMLInputElement | null;
    expect(colorPicker).not.toBeNull();
    fireEvent.change(colorPicker as HTMLInputElement, { target: { value: "#336699" } });

    expect(Array.isArray(lastValue)).toBe(true);
    if (Array.isArray(lastValue)) {
      expect(lastValue[0]).toBeCloseTo(51 / 255, 5);
      expect(lastValue[1]).toBeCloseTo(102 / 255, 5);
      expect(lastValue[2]).toBeCloseTo(153 / 255, 5);
    }
  });

  test("renders direction controls without sliders and normalizes axis edits", () => {
    const uniforms: UniformDefinition[] = [
      {
        name: "Up",
        type: "vec3",
        control: "direction",
        group: "Camera",
        min: [-1, -1, -1],
        max: [1, 1, 1],
        defaultValue: [0, 1, 0],
        lockType: "notlocked",
        tooltip: ""
      }
    ];

    const values: Record<string, UniformValue> = { Up: [0, 1, 0] };
    let lastValue: UniformValue | null = null;

    const { container } = render(
      <UniformPanel
        uniforms={uniforms}
        values={values}
        onChange={(_name, value) => {
          lastValue = value;
        }}
      />
    );

    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);
    const numericInputs = [...container.querySelectorAll(".uniform-direction-fields input[type=\"number\"]")] as HTMLInputElement[];
    expect(numericInputs).toHaveLength(3);

    fireEvent.change(numericInputs[0], { target: { value: "1" } });
    expect(Array.isArray(lastValue)).toBe(true);
    if (Array.isArray(lastValue)) {
      expect(lastValue[0]).toBeCloseTo(Math.SQRT1_2, 5);
      expect(lastValue[1]).toBeCloseTo(Math.SQRT1_2, 5);
      expect(lastValue[2]).toBeCloseTo(0, 5);
    }
  });
});
