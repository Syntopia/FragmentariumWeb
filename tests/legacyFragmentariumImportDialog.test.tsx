import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { LegacyFragmentariumImportDialog } from "../src/components/LegacyFragmentariumImportDialog";
import type { SystemsTreeNode } from "../src/components/SystemsTreeView";

describe("LegacyFragmentariumImportDialog", () => {
  test("renders system tree and forwards select and close actions", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const nodes: SystemsTreeNode[] = [
      {
        type: "leaf",
        id: "preset-leaf:mandelbulb",
        name: "Mandelbulb",
        entryKey: "preset:mandelbulb"
      }
    ];

    render(
      <LegacyFragmentariumImportDialog
        open={true}
        nodes={nodes}
        activeEntryKey="preset:mandelbulb"
        onSelect={onSelect}
        onDeleteLocal={() => undefined}
        onClose={onClose}
      />
    );

    expect(screen.getByRole("dialog", { name: "Legacy Fragmentarium Import" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mandelbulb" }));
    expect(onSelect).toHaveBeenCalledWith("preset:mandelbulb");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
