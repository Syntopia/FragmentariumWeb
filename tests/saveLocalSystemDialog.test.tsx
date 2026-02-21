import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SaveLocalSystemDialog } from "../src/components/SaveLocalSystemDialog";

describe("SaveLocalSystemDialog", () => {
  test("renders overwrite state and emits save/cancel", () => {
    let saveCount = 0;
    let cancelCount = 0;

    render(
      <SaveLocalSystemDialog
        open={true}
        pathValue="mandelbulb/mikaels"
        errorMessage={null}
        isOverwrite={true}
        onPathChange={() => undefined}
        onCancel={() => {
          cancelCount += 1;
        }}
        onSave={() => {
          saveCount += 1;
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Overwrite" })).toBeInTheDocument();
    expect(screen.getByText("Existing local system will be overwritten.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(saveCount).toBe(1);
    expect(cancelCount).toBe(1);
  });

  test("emits path changes", () => {
    let nextPath = "";

    const view = render(
      <SaveLocalSystemDialog
        open={true}
        pathValue="mandelbulb/base"
        errorMessage={null}
        isOverwrite={false}
        onPathChange={(value) => {
          nextPath = value;
        }}
        onCancel={() => undefined}
        onSave={() => undefined}
      />
    );

    fireEvent.change(within(view.container).getByRole("textbox"), { target: { value: "mandelbulb/custom" } });
    expect(nextPath).toBe("mandelbulb/custom");
  });
});
