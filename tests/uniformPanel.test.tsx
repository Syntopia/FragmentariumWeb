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
});
