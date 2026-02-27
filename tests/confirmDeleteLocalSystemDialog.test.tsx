import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ConfirmDeleteLocalSystemDialog } from "../src/components/ConfirmDeleteLocalSystemDialog";

describe("ConfirmDeleteLocalSystemDialog", () => {
  test("emits confirm and cancel actions", () => {
    let confirmCount = 0;
    let cancelCount = 0;

    render(
      <ConfirmDeleteLocalSystemDialog
        open={true}
        localPath="mandelbulb/mikaels"
        onCancel={() => {
          cancelCount += 1;
        }}
        onConfirm={() => {
          confirmCount += 1;
        }}
      />
    );

    expect(screen.getByText("Delete session `mandelbulb/mikaels`?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirmCount).toBe(1);
    expect(cancelCount).toBe(1);
  });
});
