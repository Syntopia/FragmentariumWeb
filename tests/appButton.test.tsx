import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppButton } from "../src/components/AppButton";

describe("AppButton", () => {
  test("uses button type by default and applies variant classes", () => {
    render(<AppButton variant="primary">Export</AppButton>);
    const button = screen.getByRole("button", { name: "Export" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("app-button");
    expect(button.className).toContain("is-primary");
    expect(button.className).toContain("is-sm");
  });

  test("supports explicit variant and size combinations", () => {
    render(
      <AppButton variant="danger" size="md">
        Delete
      </AppButton>
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.className).toContain("is-danger");
    expect(button.className).toContain("is-md");
  });
});
