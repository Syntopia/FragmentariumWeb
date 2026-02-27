import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { DefinitionEditor } from "../src/components/DefinitionEditor";

describe("DefinitionEditor", () => {
  test("uses matching editor font layer and disables soft wrapping", () => {
    const view = render(<DefinitionEditor value={"float x = 1.0;"} onChange={() => undefined} onBuild={() => undefined} />);

    const textarea = within(view.container).getByRole("textbox");
    expect(textarea).toHaveClass("source-editor");
    expect(textarea).toHaveAttribute("wrap", "off");

    const highlight = document.querySelector(".definition-editor-highlight");
    expect(highlight).not.toBeNull();
    expect(highlight).toHaveClass("source-editor");
  });

  test("inserts indentation when pressing Tab", () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState("float x = 1.0;");
      return <DefinitionEditor value={value} onChange={setValue} onBuild={() => undefined} />;
    }

    const view = render(<Harness />);
    const textarea = within(view.container).getByRole("textbox") as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toBe("  float x = 1.0;");
  });
});
