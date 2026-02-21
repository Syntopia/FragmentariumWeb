import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CollapsibleSection } from "../src/components/CollapsibleSection";

describe("CollapsibleSection", () => {
  test("toggles content visibility and aria-expanded", () => {
    render(
      <CollapsibleSection title="Example" defaultOpen={true}>
        <p>Body</p>
      </CollapsibleSection>
    );

    const button = screen.getByRole("button", { name: "Example" });
    const body = screen.getByText("Body");

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(body).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(body).not.toBeVisible();
  });

  test("only applies grow class while open when growWhenOpen is enabled", () => {
    render(
      <CollapsibleSection title="Grow" defaultOpen={true} growWhenOpen={true}>
        <p>Content</p>
      </CollapsibleSection>
    );

    const button = screen.getByRole("button", { name: "Grow" });
    const section = button.closest("section");
    expect(section).not.toBeNull();
    expect(section?.className).toContain("grow");

    fireEvent.click(button);
    expect(section?.className).not.toContain("grow");
  });
});
