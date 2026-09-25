/** @vitest-environment jsdom */
import {
  AttachmentQueueRepository,
  BootstrapRepository,
  ProtectedOfflineRepository,
  SyncClient,
  YjsNoteRepository,
  type AttachmentQueueEntry,
  type LocalEntity,
} from "@logion/offline";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  session: {} as Record<string, unknown>,
}));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user-1" } },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.session,
}));
vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request: (...args: unknown[]) => mocks.request(...args) },
  LogionApiError: class extends Error {},
}));
afterEach(() => {
  window.sessionStorage.clear();
  cleanup();
  vi.restoreAllMocks();
});

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
  useRecordsController,
} from "./use-records-controller";

it.each([
  { stage: "synchronize", change: "device" },
  { stage: "unlock", change: "device" },
  { stage: "unlock", change: "roundtrip" },
  { stage: "unlock", change: "same" },
  { stage: "permission", change: "device" },
  { stage: "refresh", change: "workspace" },
] as const)(
  "guards a delayed $stage operation after $change context",
  async ({ stage, change }) => {
    const workspaceA = "11111111-1111-4111-8111-111111111111";
    const workspaceB = "22222222-2222-4222-8222-222222222222";
    const deviceA = "33333333-3333-4333-8333-333333333333";
    const deviceB = "44444444-4444-4444-8444-444444444444";
    let currentDevice = deviceA;
    let armed = false;
    let held = false;
    let finish!: (value: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const collection = {
      where: () => ({
        equals: () => ({ toArray: async () => [], count: async () => 0 }),
      }),
    };
    const db = {
      attachmentQueue: collection,
      outbox: collection,
      conflicts: collection,
      syncState: { get: async () => undefined },
      entities: {
        where: () => ({
          equals: () => ({
            toArray: async () => {
              if (armed && !held && stage === "refresh") {
                held = true;
                return delayed;
              }
              return [];
            },
          }),
        }),
      },
    };
    const localVault = {};
    Object.assign(mocks.session, {
      database: { current: db },
      vault: { current: localVault },
      phase: "unlocked",
      revision: 1,
      markChanged: vi.fn(),
      unlock: vi.fn(async () => ({
        database: db,
        vault: localVault,
        initialized: false,
      })),
    });
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces")
        return {
          workspaces: [
            { id: workspaceA, name: "A", role: "owner" },
            { id: workspaceB, name: "B", role: "owner" },
          ],
        };
      if (path === "/api/v1/auth/devices")
        return { devices: [{ id: currentDevice, current: true }] };
      if (path.endsWith("/spaces"))
        return {
          spaces: [
            {
              id: `${path.includes(workspaceA) ? workspaceA : workspaceB}-space`,
              name: "Private",
              visibility: "private",
            },
          ],
        };
      if (path.endsWith("/attachments/capability")) {
        if (stage === "permission") {
          held = true;
          return delayed;
        }
        return { ingest_enabled: true };
      }
      if (path.endsWith("/sync/bootstrap")) {
        held = true;
        return delayed;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const prepare = vi
      .spyOn(BootstrapRepository.prototype, "prepareDeviceRebootstrap")
      .mockResolvedValue(undefined);
    const stageChunk = vi
      .spyOn(BootstrapRepository.prototype, "stageChunk")
      .mockResolvedValue({
        workspace_id: workspaceA,
        snapshot_id: deviceB,
        received_chunks: 1,
        chunk_count: 1,
        received_records: 0,
        complete: true,
      });
    const sync = vi
      .spyOn(SyncClient.prototype, "synchronize")
      .mockResolvedValue({
        pushed: 0,
        pulled: 0,
        has_more: false,
        control: null,
      });
    const enqueue = vi
      .spyOn(AttachmentQueueRepository.prototype, "enqueue")
      .mockResolvedValue({} as AttachmentQueueEntry);
    const { result } = renderHook(() => useRecordsController());
    await waitFor(() =>
      expect(result.current.context.operationalState?.kind).toBe("empty"),
    );
    let operation!: Promise<boolean>;
    act(() => {
      armed = true;
      operation =
        stage === "synchronize"
          ? result.current.commands.synchronize()
          : stage === "unlock"
            ? result.current.commands.unlock("synthetic passphrase")
            : result.current.commands.queueAttachment(
                "note-1",
                new File(["synthetic"], "note.txt", { type: "text/plain" }),
              );
    });
    await waitFor(() => expect(held).toBe(true));
    if (change === "workspace") {
      act(() => result.current.commands.setWorkspaceId(workspaceB));
      await waitFor(() =>
        expect(result.current.context.spaceId).toBe(`${workspaceB}-space`),
      );
      await waitFor(() =>
        expect(result.current.context.operationalState?.kind).toBe("empty"),
      );
    } else if (change !== "same") {
      for (const nextDevice of change === "roundtrip"
        ? [deviceB, deviceA]
        : [deviceB]) {
        currentDevice = nextDevice;
        await act(async () => {
          await result.current.commands.loadContext();
        });
      }
    }
    act(() =>
      result.current.commands.reportDeletion("current context feedback"),
    );
    const currentKind = result.current.context.operationalState?.kind;
    if (change !== "same") expect(currentKind).not.toBe("pending");
    const bootstrapResponse = {
      message_type: "bootstrap_response",
      protocol_version: "sync-v1",
      min_supported_version: "sync-v1",
      workspace_id: workspaceA,
      device_id: deviceA,
      sync_epoch: workspaceB,
      snapshot_schema_version: 1,
      snapshot_id: deviceB,
      chunk_index: 0,
      chunk_count: 1,
      cursor: 0,
      snapshot_checksum: `sha256:${"0".repeat(64)}`,
      chunk_checksum: `sha256:${"0".repeat(64)}`,
      records: [],
      created_at: "2026-09-21T00:00:00Z",
    };
    await act(async () => {
      finish(
        stage === "permission"
          ? { ingest_enabled: true }
          : stage === "refresh"
            ? []
            : bootstrapResponse,
      );
      expect(await operation).toBe(change === "same");
    });
    // A valid same-device response proves stale replies are rejected before storage.
    expect(prepare).toHaveBeenCalledTimes(change === "same" ? 1 : 0);
    expect(stageChunk).toHaveBeenCalledTimes(change === "same" ? 1 : 0);
    expect(sync).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(stage === "refresh" ? 1 : 0);
    if (change !== "same") {
      expect(result.current.context.status).toBe("current context feedback");
      expect(result.current.context.operationalState?.kind).toBe(currentKind);
    }
  },
);

it("does not enable an unlock form that would be discarded by the initial space selection", async () => {
  let finish!: (value: unknown) => void;
  const spaces = new Promise((resolve) => {
    finish = resolve;
  });
  Object.assign(mocks.session, {
    database: { current: null },
    vault: { current: null },
    phase: "locked",
    revision: 0,
    markChanged: vi.fn(),
    unlock: vi.fn(),
  });
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/api/v1/workspaces")
      return { workspaces: [{ id: "a", name: "A", role: "owner" }] };
    if (path === "/api/v1/auth/devices")
      return { devices: [{ id: "device-1", current: true }] };
    if (path.endsWith("/spaces")) return spaces;
    throw new Error("Unexpected request");
  });
  const { result } = renderHook(() => useRecordsController());
  await waitFor(() => expect(result.current.context.workspaceId).toBe("a"));
  expect(result.current.capabilities.canUnlock).toBe(false);
  await act(async () =>
    finish({
      spaces: [{ id: "a-space", name: "Private", visibility: "private" }],
    }),
  );
  await waitFor(() => expect(result.current.capabilities.canUnlock).toBe(true));
});

it.each([false, true])(
  "does not save to a new workspace after a delayed document query (Yjs=%s)",
  async (hasYjs) => {
    const workspaceA = "11111111-1111-4111-8111-111111111111";
    const workspaceB = "22222222-2222-4222-8222-222222222222";
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const documentQuery = vi.fn(() => pending);
    const collection = {
      where: () => ({
        equals: () => ({ toArray: async () => [], count: async () => 0 }),
      }),
    };
    const db = {
      entities: {
        get: documentQuery,
        where: () => ({
          equals: ([workspaceId, type]: string[]) => ({
            toArray: async () =>
              type === "note"
                ? [
                    {
                      entity_id: workspaceId,
                      workspace_id: workspaceId,
                      entity_type: "note",
                      sync_status: "clean",
                      updated_at: "2026-09-01T00:00:00.000Z",
                      payload: {
                        space_id: `${workspaceId}-space`,
                        title: "title",
                        markdown_body: "body",
                        task_id: null,
                      },
                    },
                  ]
                : [],
          }),
        }),
      },
      attachmentQueue: collection,
      outbox: collection,
      conflicts: collection,
      syncState: { get: async () => undefined },
    };
    Object.assign(mocks.session, {
      database: { current: db },
      vault: { current: {} },
      phase: "unlocked",
      revision: 1,
      markChanged: vi.fn(),
      unlock: vi.fn(),
    });
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces")
        return {
          workspaces: [
            { id: workspaceA, name: "A", role: "owner" },
            { id: workspaceB, name: "B", role: "owner" },
          ],
        };
      if (path === "/api/v1/auth/devices")
        return { devices: [{ id: "device-1", current: true }] };
      if (path.endsWith("/spaces"))
        return {
          spaces: [
            {
              id: `${path.includes(workspaceA) ? workspaceA : workspaceB}-space`,
              name: "Space",
              visibility: "private",
            },
          ],
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    const commit = vi.spyOn(
      ProtectedOfflineRepository.prototype,
      "commitMutation",
    );
    const yjs = vi.spyOn(YjsNoteRepository.prototype, "commitMarkdown");
    const { result } = renderHook(() => useRecordsController());
    await waitFor(() =>
      expect(result.current.viewModel.selectedNote?.entity.entity_id).toBe(
        workspaceA,
      ),
    );
    let save!: Promise<boolean>;
    act(() => {
      save = result.current.commands.saveNote(workspaceA, {
        title: "title",
        markdownBody: "changed",
      });
    });
    expect(documentQuery).toHaveBeenCalled();
    act(() => result.current.commands.setWorkspaceId(workspaceB));
    await waitFor(() =>
      expect(result.current.viewModel.selectedNote?.entity.entity_id).toBe(
        workspaceB,
      ),
    );
    act(() => result.current.commands.reportDeletion("B current feedback"));
    await act(async () => {
      finish(hasYjs ? {} : undefined);
      expect(await save).toBe(false);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(yjs).not.toHaveBeenCalled();
    expect(result.current.context.status).toBe("B current feedback");
  },
);

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
