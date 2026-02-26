import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ColorPickerButton } from "../src/components/ColorPickerButton";

describe("ColorPickerButton", () => {
  test("shows hex text and forwards native color input changes", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorPickerButton
        value="#336699"
        ariaLabel="Tint color"
        onChange={onChange}
      />
    );

    expect(screen.getByRole("button", { name: "Tint color" })).toHaveTextContent("#336699");

    const nativeInput = container.querySelector('input[type="color"]') as HTMLInputElement | null;
    expect(nativeInput).not.toBeNull();
    fireEvent.change(nativeInput as HTMLInputElement, { target: { value: "#112233" } });

    expect(onChange).toHaveBeenCalledWith("#112233");
  });
});
