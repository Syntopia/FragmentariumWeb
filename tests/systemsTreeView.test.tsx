import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SystemsTreeView, type SystemsTreeNode } from "../src/components/SystemsTreeView";

describe("SystemsTreeView", () => {
  test("selects leaf entries", () => {
    const nodes: SystemsTreeNode[] = [
      {
        type: "folder",
        id: "preset-root",
        name: "System Presets",
        children: [
          {
            type: "leaf",
            id: "leaf-mandelbulb",
            name: "Mandelbulb",
            entryKey: "preset:mandelbulb"
          }
        ]
      }
    ];

    let selected: string | null = null;
    render(
      <SystemsTreeView
        nodes={nodes}
        activeEntryKey="preset:other"
        onSelect={(entryKey) => {
          selected = entryKey;
        }}
        onDeleteLocal={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Mandelbulb" }));
    expect(selected).toBe("preset:mandelbulb");
  });

  test("emits delete for local leaves", () => {
    const nodes: SystemsTreeNode[] = [
      {
        type: "folder",
        id: "local-root",
        name: "Local Storage",
        children: [
          {
            type: "leaf",
            id: "leaf-local",
            name: "mikaels",
            entryKey: "local:mandelbulb/mikaels",
            localPath: "mandelbulb/mikaels"
          }
        ]
      }
    ];

    let deleted: string | null = null;
    render(
      <SystemsTreeView
        nodes={nodes}
        activeEntryKey="local:mandelbulb/mikaels"
        onSelect={() => undefined}
        onDeleteLocal={(path) => {
          deleted = path;
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete mikaels" }));
    expect(deleted).toBe("mandelbulb/mikaels");
  });
});
