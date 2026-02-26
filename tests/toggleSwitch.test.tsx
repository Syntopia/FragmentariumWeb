import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ToggleSwitch } from "../src/components/ToggleSwitch";

describe("ToggleSwitch", () => {
  test("shows on/off text and forwards checked state", () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <ToggleSwitch
        checked={false}
        ariaLabel="Example toggle"
        onChange={onChange}
      />
    );

    expect(screen.getByText("Off")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Example toggle" }));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <ToggleSwitch
        checked={true}
        ariaLabel="Example toggle"
        onChange={onChange}
      />
    );

    expect(screen.getByText("On")).toBeInTheDocument();
  });
});
