import type { AttachmentQueueEntry, LocalEntity } from "@logion/offline";
import { describe, expect, it } from "vitest";

import {
  deriveRecordsOperationalKind,
  deriveRecordsViewModel,
  filterRecords,
  RECORDS_COMMAND_KEYS,
  recordsNoteSaveMode,
  shouldApplyRecordsResponse,
  type RecordsLocalView,
  type RecordsNotePayload,
  type RecordsResourcePayload,
} from "./use-records-controller";

function entity(id: string, updatedAt: string): LocalEntity {
  return {
    entity_id: id,
    updated_at: updatedAt,
  } as LocalEntity;
}

function note(
  id: string,
  spaceId: string,
  updatedAt: string,
): RecordsLocalView<RecordsNotePayload> {
  return {
    entity: entity(id, updatedAt),
    payload: {
      markdown_body: `${id} markdown`,
      space_id: spaceId,
      task_id: null,
      title: `${id} title`,
    },
  };
}

function resource(
  id: string,
  type: RecordsResourcePayload["resource_type"],
): RecordsLocalView<RecordsResourcePayload> {
  return {
    entity: entity(id, "2026-08-25T00:00:00.000Z"),
    payload: {
      page_count: type === "pdf_index" ? 10 : null,
      page_index:
        type === "pdf_index" ? [{ label: "一致性", note: "", page: 4 }] : [],
      pdf_filename: type === "pdf_index" ? "raft.pdf" : null,
      resource_type: type,
      sha256: null,
      source_url: type === "link" ? "https://example.com/raft" : null,
      space_id: "space-1",
      task_id: null,
      title: id,
    },
  };
}

function attachment(filename: string): AttachmentQueueEntry {
  return {
    attachment_id: filename,
    byte_size: 10,
    device_id: "device-1",
    filename,
    media_type: "text/plain",
    queued_at: "2026-08-26T00:00:00.000Z",
    sha256: "sha256:abc",
    space_id: "space-1",
    state: "pending_upload",
    target_id: "note-1",
    target_type: "note",
    workspace_id: "workspace-1",
  } as AttachmentQueueEntry;
}

describe("Records controller contract", () => {
  it("keeps every formal Records command reachable", () => {
    expect(RECORDS_COMMAND_KEYS).toEqual([
      "createNote",
      "createResource",
      "loadContext",
      "queueAttachment",
      "renameResource",
      "saveNote",
      "selectNote",
      "setSpaceId",
      "setWorkspaceId",
      "synchronize",
      "unlock",
    ]);
  });

  it("derives one selected note and real Space totals without cross-Space leaks", () => {
    const older = note("older", "space-1", "2026-08-24T00:00:00.000Z");
    const newer = note("newer", "space-1", "2026-08-26T00:00:00.000Z");
    const other = note("other", "space-2", "2026-08-27T00:00:00.000Z");
    const model = deriveRecordsViewModel({
      attachments: [attachment("evidence.txt")],
      notes: [older, other, newer],
      resources: [
        resource("Raft link", "link"),
        resource("Raft PDF", "pdf_index"),
      ],
      selectedNoteId: "older",
      spaceId: "space-1",
    });

    expect(model.notes.map((item) => item.entity.entity_id)).toEqual([
      "newer",
      "older",
    ]);
    expect(model.selectedNote?.entity.entity_id).toBe("older");
    expect(model.noteCharacterCount).toBe(
      older.payload.markdown_body.length + newer.payload.markdown_body.length,
    );
    expect(model.indexedPageCount).toBe(1);
    expect(model.attachmentCount).toBe(1);
  });

  it("searches notes, links, PDF metadata and attachments without changing object types", () => {
    const model = deriveRecordsViewModel({
      attachments: [attachment("evidence.txt")],
      notes: [note("Raft", "space-1", "2026-08-26T00:00:00.000Z")],
      resources: [
        resource("Consensus", "link"),
        resource("Lecture", "pdf_index"),
      ],
      selectedNoteId: "",
      spaceId: "space-1",
    });

    expect(filterRecords(model, "note", "markdown").notes).toHaveLength(1);
    expect(filterRecords(model, "link", "example.com").resources).toHaveLength(
      1,
    );
    expect(
      filterRecords(model, "pdf_index", "raft.pdf").resources,
    ).toHaveLength(1);
    expect(
      filterRecords(model, "attachment", "evidence").attachments,
    ).toHaveLength(1);
  });

  it("preserves the existing synchronize, Yjs and entity commit branches", () => {
    expect(
      recordsNoteSaveMode({
        bodyChanged: false,
        hasYjsState: true,
        titleChanged: false,
      }),
    ).toBe("synchronize");
    expect(
      recordsNoteSaveMode({
        bodyChanged: true,
        hasYjsState: true,
        titleChanged: false,
      }),
    ).toBe("yjs");
    expect(
      recordsNoteSaveMode({
        bodyChanged: true,
        hasYjsState: true,
        titleChanged: true,
      }),
    ).toBe("commit");
  });

  it("rejects stale refreshes after request or Workspace changes", () => {
    expect(shouldApplyRecordsResponse(3, 3, "workspace-1", "workspace-1")).toBe(
      true,
    );
    expect(shouldApplyRecordsResponse(2, 3, "workspace-1", "workspace-1")).toBe(
      false,
    );
    expect(shouldApplyRecordsResponse(3, 3, "workspace-1", "workspace-2")).toBe(
      false,
    );
  });

  it("prioritizes conflict, offline and recovery states over empty presentation", () => {
    const base = {
      commandPhase: "idle" as const,
      conflictCount: 0,
      contextPhase: "ready" as const,
      dataPhase: "ready" as const,
      deviceAvailable: true,
      hasContext: true,
      hasData: true,
      online: true,
      stale: false,
      unlocked: true,
    };
    expect(deriveRecordsOperationalKind({ ...base, unlocked: false })).toBe(
      "locked",
    );
    expect(deriveRecordsOperationalKind({ ...base, conflictCount: 1 })).toBe(
      "conflict",
    );
    expect(deriveRecordsOperationalKind({ ...base, online: false })).toBe(
      "offline",
    );
    expect(deriveRecordsOperationalKind({ ...base, hasData: false })).toBe(
      "empty",
    );
    expect(deriveRecordsOperationalKind(base)).toBeNull();
  });
});
