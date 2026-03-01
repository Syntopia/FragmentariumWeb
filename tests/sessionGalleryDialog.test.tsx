import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SessionGalleryDialog, type SessionGalleryItem } from "../src/components/SessionGalleryDialog";

const STORAGE_INFO = {
  snapshotStorageBytes: 0,
  originUsageBytes: null,
  originQuotaBytes: null,
  persistentStorageStatus: "unknown" as const
};

function buildItems(): SessionGalleryItem[] {
  return [
    {
      id: "local:a",
      path: "Local Sessions/folder/a",
      tileLabel: "a",
      previewUrl: "https://example.com/a.jpg",
      createdAtMs: 1,
      updatedAtMs: 2,
      sourceKind: "local",
      localPath: "folder/a"
    },
    {
      id: "local:b",
      path: "Local Sessions/folder/b",
      tileLabel: "b",
      previewUrl: "https://example.com/b.jpg",
      createdAtMs: 1,
      updatedAtMs: 3,
      sourceKind: "local",
      localPath: "folder/b"
    },
    {
      id: "gh:c",
      path: "GitHub/source/c",
      tileLabel: "c",
      previewUrl: "https://example.com/c.jpg",
      createdAtMs: null,
      updatedAtMs: 4,
      sourceKind: "github",
      remotePngUrl: "https://example.com/c.png"
    }
  ];
}

describe("SessionGalleryDialog", () => {
  test("bulk deletes local sessions at a folder level after confirmation", async () => {
    const onDeleteSessions = vi.fn(async () => undefined);

    render(
      <SessionGalleryDialog
        open={true}
        items={buildItems()}
        externalSources={[]}
        storageInfo={STORAGE_INFO}
        isBusy={false}
        persistentStorageRequestInProgress={false}
        onClose={() => undefined}
        onOpenSession={() => undefined}
        onDeleteSession={() => undefined}
        onDeleteSessions={onDeleteSessions}
        onRenameSession={() => undefined}
        onRequestPersistentStorage={() => undefined}
        onExportAll={() => undefined}
        onImportZip={() => undefined}
        onAddExternalGitHubSource={() => Promise.resolve()}
        onRefreshExternalSource={() => Promise.resolve()}
        onRemoveExternalSource={() => undefined}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Delete all local sessions in Local Sessions/folder" })[0]);
    expect(screen.getByRole("dialog", { name: "Delete Folder Sessions" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete 2 Sessions" }));

    await waitFor(() => {
      expect(onDeleteSessions).toHaveBeenCalledWith(["folder/a", "folder/b"]);
    });
  });
});
