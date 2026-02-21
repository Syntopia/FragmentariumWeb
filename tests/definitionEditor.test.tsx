import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DefinitionEditor } from "../src/components/DefinitionEditor";

describe("DefinitionEditor", () => {
  test("uses matching editor font layer and disables soft wrapping", () => {
    render(<DefinitionEditor value={"float x = 1.0;"} onChange={() => undefined} onBuild={() => undefined} />);

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveClass("source-editor");
    expect(textarea).toHaveAttribute("wrap", "off");

    const highlight = document.querySelector(".definition-editor-highlight");
    expect(highlight).not.toBeNull();
    expect(highlight).toHaveClass("source-editor");
  });
});
