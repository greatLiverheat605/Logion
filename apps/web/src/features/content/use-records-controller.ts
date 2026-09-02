"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  AttachmentQueueRepository,
  BootstrapRepository,
  noteDocumentStateId,
  OfflineStorageError,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
  YjsNoteRepository,
  type AttachmentQueueEntry,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "@logion/offline";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ProductOperationalState,
  ProductOperationalStateKind,
} from "@/components/product/product-workbench-state";
import type { WorkbenchOperationalContext } from "@/components/product/workbench";
import { useSession } from "@/features/auth/session-provider";
import { offlineCapabilityMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

export type RecordsWorkspace = components["schemas"]["WorkspaceResponse"];
export type RecordsSpace = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];

export interface RecordsLocalView<T> {
  entity: LocalEntity;
  payload: T;
}

export type RecordsNotePayload = JsonObject & {
  markdown_body: string;
  space_id: string;
  task_id: string | null;
  title: string;
};

export type RecordsPageEntry = JsonObject & {
  label: string;
  note: string;
  page: number;
};

export type RecordsResourcePayload = JsonObject & {
  page_count: number | null;
  page_index: RecordsPageEntry[];
  pdf_filename: string | null;
  resource_type: "link" | "pdf_index";
  sha256: string | null;
  source_url: string | null;
  space_id: string;
  task_id: string | null;
  title: string;
};

export type RecordsKind = "all" | "attachment" | "link" | "note" | "pdf_index";

export interface RecordsResourceInput {
  label?: string;
  note?: string;
  page?: number;
  pageCount?: number;
  pdfFilename?: string;
  resourceType: "link" | "pdf_index";
  sourceUrl?: string;
  title: string;
}

export interface RecordsDerivedViewModel {
  attachmentCount: number;
  attachments: AttachmentQueueEntry[];
  indexedPageCount: number;
  noteCharacterCount: number;
  notes: RecordsLocalView<RecordsNotePayload>[];
  resourceCount: number;
  resources: RecordsLocalView<RecordsResourcePayload>[];
  selectedNote: RecordsLocalView<RecordsNotePayload> | null;
}

export interface RecordsFilteredView {
  attachments: AttachmentQueueEntry[];
  notes: RecordsLocalView<RecordsNotePayload>[];
  resources: RecordsLocalView<RecordsResourcePayload>[];
}

type Phase = "error" | "idle" | "loading" | "ready";
type CommandPhase = "idle" | "pending" | "success";

interface RecordsIssue {
  kind: Extract<
    ProductOperationalStateKind,
    "capability-disabled" | "conflict" | "error" | "permission"
  >;
  requestId?: string;
}

export const RECORDS_COMMAND_KEYS = [
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
] as const;

export function safeRecordsExternalUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function shouldApplyRecordsResponse(
  requestId: number,
  currentRequestId: number,
  requestWorkspaceId: string,
  currentWorkspaceId: string,
): boolean {
  return (
    requestId === currentRequestId && requestWorkspaceId === currentWorkspaceId
  );
}

export function recordsNoteSaveMode({
  bodyChanged,
  hasYjsState,
  titleChanged,
}: {
  bodyChanged: boolean;
  hasYjsState: boolean;
  titleChanged: boolean;
}): "commit" | "synchronize" | "yjs" {
  if (!bodyChanged && !titleChanged) return "synchronize";
  return bodyChanged && !titleChanged && hasYjsState ? "yjs" : "commit";
}

function newestFirst<T extends { entity: LocalEntity }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    right.entity.updated_at.localeCompare(left.entity.updated_at),
  );
}

export function deriveRecordsViewModel({
  attachments,
  notes,
  resources,
  selectedNoteId,
  spaceId,
}: {
  attachments: AttachmentQueueEntry[];
  notes: RecordsLocalView<RecordsNotePayload>[];
  resources: RecordsLocalView<RecordsResourcePayload>[];
  selectedNoteId: string;
  spaceId: string;
}): RecordsDerivedViewModel {
  const visibleNotes = newestFirst(
    notes.filter((item) => item.payload.space_id === spaceId),
  );
  const visibleResources = newestFirst(
    resources.filter((item) => item.payload.space_id === spaceId),
  );
  const visibleAttachments = [...attachments]
    .filter((item) => item.space_id === spaceId)
    .sort((left, right) => right.queued_at.localeCompare(left.queued_at));
  const selectedNote =
    visibleNotes.find((item) => item.entity.entity_id === selectedNoteId) ??
    visibleNotes[0] ??
    null;

  return {
    attachmentCount: visibleAttachments.length,
    attachments: visibleAttachments,
    indexedPageCount: visibleResources.reduce(
      (total, item) => total + item.payload.page_index.length,
      0,
    ),
    noteCharacterCount: visibleNotes.reduce(
      (total, item) => total + item.payload.markdown_body.length,
      0,
    ),
    notes: visibleNotes,
    resourceCount: visibleResources.length,
    resources: visibleResources,
    selectedNote,
  };
}

export function filterRecords(
  viewModel: RecordsDerivedViewModel,
  kind: RecordsKind,
  query: string,
): RecordsFilteredView {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (value: string) =>
    normalizedQuery === "" ||
    value.toLocaleLowerCase().includes(normalizedQuery);

  return {
    attachments: viewModel.attachments.filter(
      (item) =>
        (kind === "all" || kind === "attachment") && matches(item.filename),
    ),
    notes: viewModel.notes.filter(
      (item) =>
        (kind === "all" || kind === "note") &&
        matches(`${item.payload.title} ${item.payload.markdown_body}`),
    ),
    resources: viewModel.resources.filter(
      (item) =>
        (kind === "all" || kind === item.payload.resource_type) &&
        matches(
          `${item.payload.title} ${item.payload.source_url ?? ""} ${item.payload.pdf_filename ?? ""}`,
        ),
    ),
  };
}

export function deriveRecordsOperationalKind({
  commandPhase,
  conflictCount,
  contextPhase,
  dataPhase,
  deviceAvailable,
  hasContext,
  hasData,
  issueKind,
  online,
  stale,
  unlocked,
}: {
  commandPhase: CommandPhase;
  conflictCount: number;
  contextPhase: Exclude<Phase, "idle">;
  dataPhase: Phase;
  deviceAvailable: boolean;
  hasContext: boolean;
  hasData: boolean;
  issueKind?: RecordsIssue["kind"];
  online: boolean;
  stale: boolean;
  unlocked: boolean;
}): ProductOperationalStateKind | null {
  if (contextPhase === "error") return issueKind ?? "error";
  if (contextPhase === "loading") return "loading";
  if (!hasContext) return "empty";
  if (!deviceAvailable) return "capability-disabled";
  if (!unlocked) return "locked";
  if (dataPhase === "error") return issueKind ?? "error";
  if (issueKind && issueKind !== "error") return issueKind;
  if (!online) return "offline";
  if (dataPhase !== "ready") return "loading";
  if (conflictCount > 0) return "conflict";
  if (commandPhase === "pending") return "pending";
  if (issueKind === "error") return "error";
  if (stale) return "stale";
  if (commandPhase === "success") return "success";
  return hasData ? null : "empty";
}

function issueFrom(error: unknown): RecordsIssue {
  if (error instanceof LogionApiError) {
    const kind =
      error.status === 403 || error.status === 404
        ? "permission"
        : error.status === 409
          ? "conflict"
          : error.code.includes("CAPABILITY")
            ? "capability-disabled"
            : "error";
    return { kind, requestId: error.requestId };
  }
  return { kind: "error" };
}

function userMessage(error: unknown): string {
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null) return capabilityMessage;
  if (error instanceof LogionApiError) {
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  if (error instanceof OfflineStorageError) {
    return "本地资料操作未完成；未确认写入的数据不会标记为已保存。";
  }
  return "操作未完成，请检查网络与本地资料状态后重试。";
}

function subscribeOnline(change: () => void): () => void {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function transport(workspaceId: string): SyncTransport {
  const call = (path: string, request: unknown, csrf = false) =>
    browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/${path}`, {
      body: JSON.stringify(request),
      csrf,
      method: "POST",
    });
  return {
    pull: (request) => call("pull", request),
    push: (request) => call("push", request, true),
  };
}

async function decrypt<T>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<RecordsLocalView<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  const value =
    typeof reference === "string"
      ? await vault.get(reference, entity.workspace_id)
      : entity.payload;
  if (value === null) throw new Error("protected payload unavailable");
  return { entity, payload: value as unknown as T };
}

export interface RecordsControllerResult {
  capabilities: {
    canCreate: boolean;
    canSync: boolean;
    canUnlock: boolean;
    canWrite: boolean;
  };
  commands: {
    createNote: (input: {
      markdownBody: string;
      title: string;
    }) => Promise<string | null>;
    createResource: (input: RecordsResourceInput) => Promise<boolean>;
    loadContext: () => Promise<void>;
    queueAttachment: (noteId: string, file: File) => Promise<boolean>;
    renameResource: (resourceId: string, title: string) => Promise<boolean>;
    saveNote: (
      noteId: string,
      input: { markdownBody: string; title: string },
    ) => Promise<boolean>;
    selectNote: (noteId: string) => void;
    setSpaceId: (spaceId: string) => void;
    setWorkspaceId: (workspaceId: string) => void;
    synchronize: () => Promise<boolean>;
    unlock: (passphrase: string) => Promise<boolean>;
  };
  context: {
    online: boolean;
    operational: WorkbenchOperationalContext;
    operationalState: ProductOperationalState | null;
    spaceId: string;
    spaces: RecordsSpace[];
    status: string;
    unlocked: boolean;
    workspaceId: string;
    workspaces: RecordsWorkspace[];
  };
  viewModel: RecordsDerivedViewModel & { conflictCount: number };
}

export function useRecordsController(): RecordsControllerResult {
  const { state: session } = useSession();
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const workspaceIdRef = useRef("");
  const deviceIdRef = useRef("");
  const contextRequest = useRef(0);
  const spaceRequest = useRef(0);
  const recordsRequest = useRef(0);
  const unlocked = vaultPhase === "unlocked";
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    () => true,
  );

  const [workspaces, setWorkspaces] = useState<RecordsWorkspace[]>([]);
  const [spaces, setSpaces] = useState<RecordsSpace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState("");
  const [spaceId, setSpaceIdState] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [status, setStatus] = useState("正在准备记录与资料库……");
  const [notes, setNotes] = useState<RecordsLocalView<RecordsNotePayload>[]>(
    [],
  );
  const [resources, setResources] = useState<
    RecordsLocalView<RecordsResourcePayload>[]
  >([]);
  const [attachments, setAttachments] = useState<AttachmentQueueEntry[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [contextPhase, setContextPhase] =
    useState<Exclude<Phase, "idle">>("loading");
  const [dataPhase, setDataPhase] = useState<Phase>("idle");
  const [commandPhase, setCommandPhase] = useState<CommandPhase>("idle");
  const [issue, setIssue] = useState<RecordsIssue | null>(null);

  const loadContext = useCallback(async () => {
    const requestId = ++contextRequest.current;
    setContextPhase("loading");
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: RecordsWorkspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      if (requestId !== contextRequest.current) return;
      const currentDevice = deviceResult.devices.find((item) => item.current);
      const nextWorkspace = workspaceResult.workspaces[0]?.id ?? "";
      workspaceIdRef.current = nextWorkspace;
      deviceIdRef.current = currentDevice?.id ?? "";
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceIdState(nextWorkspace);
      setDeviceId(currentDevice?.id ?? "");
      setIssue(null);
      setStatus(
        currentDevice
          ? "请选择 Space 并解锁本地资料。"
          : "当前浏览器没有可用设备，请先完成设备注册。",
      );
      setContextPhase("ready");
    } catch (error) {
      if (requestId !== contextRequest.current) return;
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setContextPhase("error");
    }
  }, []);

  useEffect(() => {
    if (session.status === "authenticated") {
      queueMicrotask(() => void loadContext());
    }
  }, [loadContext, session.status]);

  useEffect(() => {
    if (!workspaceId) return;
    const requestId = ++spaceRequest.current;
    const selectedWorkspace = workspaceId;
    queueMicrotask(() => {
      setContextPhase("loading");
      void browserApiClient
        .request<{ spaces: RecordsSpace[] }>(
          `/api/v1/workspaces/${selectedWorkspace}/spaces`,
        )
        .then((result) => {
          if (
            requestId !== spaceRequest.current ||
            selectedWorkspace !== workspaceIdRef.current
          ) {
            return;
          }
          setSpaces(result.spaces);
          setSpaceIdState(result.spaces[0]?.id ?? "");
          setIssue(null);
          setContextPhase("ready");
        })
        .catch((error: unknown) => {
          if (
            requestId !== spaceRequest.current ||
            selectedWorkspace !== workspaceIdRef.current
          ) {
            return;
          }
          setSpaces([]);
          setSpaceIdState("");
          setIssue(issueFrom(error));
          setContextPhase("error");
          setStatus(userMessage(error));
        });
    });
  }, [workspaceId]);

  const bootstrap = useCallback(
    async (
      db: LogionOfflineDatabase,
      localVault: OfflineVault,
      selectedWorkspace: string,
      selectedDevice: string,
    ) => {
      const current = await db.syncState.get(selectedWorkspace);
      if (
        current?.bootstrap_state === "ready" &&
        current.device_id === selectedDevice
      ) {
        return;
      }
      const repository = new BootstrapRepository(db, {}, localVault);
      const fetchChunk = (
        snapshotId: string | null,
        chunkIndex: number | null,
      ) =>
        browserApiClient.request<unknown>(
          `/api/v1/workspaces/${selectedWorkspace}/sync/bootstrap`,
          {
            body: JSON.stringify({
              chunk_index: chunkIndex,
              device_id: selectedDevice,
              known_sync_epoch: current?.sync_epoch ?? null,
              message_type: "bootstrap_request",
              protocol_version: "sync-v1",
              snapshot_id: snapshotId,
              workspace_id: selectedWorkspace,
            }),
            method: "POST",
          },
        );
      const first = await fetchChunk(null, null);
      const validation = validateSyncV1Message(first);
      if (
        !validation.ok ||
        validation.value.message_type !== "bootstrap_response"
      ) {
        throw new Error("invalid bootstrap response");
      }
      const manifest = validation.value;
      await repository.stageChunk(first, {
        device_id: selectedDevice,
        workspace_id: selectedWorkspace,
      });
      for (let index = 1; index < manifest.chunk_count; index += 1) {
        await repository.stageChunk(
          await fetchChunk(manifest.snapshot_id, index),
          {
            device_id: selectedDevice,
            workspace_id: selectedWorkspace,
          },
        );
      }
    },
    [],
  );

  const refresh = useCallback(
    async (
      db: LogionOfflineDatabase | null,
      localVault: OfflineVault | null,
      selectedWorkspace: string,
    ) => {
      if (db === null || localVault === null || !selectedWorkspace) return;
      const requestId = ++recordsRequest.current;
      setDataPhase("loading");
      try {
        const [noteRows, resourceRows, attachmentRows, openConflicts] =
          await Promise.all([
            db.entities
              .where("[workspace_id+entity_type]")
              .equals([selectedWorkspace, "note"])
              .toArray(),
            db.entities
              .where("[workspace_id+entity_type]")
              .equals([selectedWorkspace, "resource"])
              .toArray(),
            db.attachmentQueue
              .where("workspace_id")
              .equals(selectedWorkspace)
              .toArray(),
            db.conflicts
              .where("[workspace_id+status]")
              .equals([selectedWorkspace, "open"])
              .count(),
          ]);
        const [nextNotes, nextResources] = await Promise.all([
          Promise.all(
            noteRows.map((item) =>
              decrypt<RecordsNotePayload>(localVault, item),
            ),
          ),
          Promise.all(
            resourceRows.map((item) =>
              decrypt<RecordsResourcePayload>(localVault, item),
            ),
          ),
        ]);
        if (
          !shouldApplyRecordsResponse(
            requestId,
            recordsRequest.current,
            selectedWorkspace,
            workspaceIdRef.current,
          )
        ) {
          return;
        }
        setNotes(nextNotes);
        setResources(nextResources);
        setAttachments(attachmentRows);
        setConflictCount(openConflicts);
        setDataPhase("ready");
      } catch (error) {
        if (
          !shouldApplyRecordsResponse(
            requestId,
            recordsRequest.current,
            selectedWorkspace,
            workspaceIdRef.current,
          )
        ) {
          return;
        }
        setIssue(issueFrom(error));
        setStatus(userMessage(error));
        setDataPhase("error");
        throw error;
      }
    },
    [],
  );

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    queueMicrotask(() => {
      void refresh(db, localVault, workspaceId)
        .then(() => {
          if (workspaceId === workspaceIdRef.current) {
            setIssue(null);
            setStatus(
              "本地资料已解锁；安全预览只渲染 Markdown 结构，不执行 HTML。",
            );
          }
        })
        .catch(() => undefined);
    });
  }, [database, refresh, unlocked, vault, vaultRevision, workspaceId]);

  const synchronizeCore = useCallback(async (): Promise<boolean> => {
    const db = database.current;
    const localVault = vault.current;
    const selectedWorkspace = workspaceIdRef.current;
    const selectedDevice = deviceIdRef.current;
    if (
      db === null ||
      localVault === null ||
      !selectedWorkspace ||
      !selectedDevice
    ) {
      return false;
    }
    let synchronized = false;
    try {
      await new SyncClient(
        db,
        transport(selectedWorkspace),
        localVault,
      ).synchronize(selectedWorkspace, selectedDevice);
      synchronized = true;
      if (selectedWorkspace === workspaceIdRef.current) {
        setIssue(null);
        setStatus("笔记与资料索引已同步。");
      }
    } catch (error) {
      if (selectedWorkspace === workspaceIdRef.current) {
        setIssue(issueFrom(error));
        setStatus(userMessage(error));
      }
    } finally {
      await refresh(db, localVault, selectedWorkspace).catch(() => undefined);
    }
    return synchronized;
  }, [database, refresh, vault]);

  async function synchronize(): Promise<boolean> {
    setCommandPhase("pending");
    const result = await synchronizeCore();
    setCommandPhase(result ? "success" : "idle");
    return result;
  }

  async function commit(
    entityType: "note" | "resource",
    entityId: string,
    payload: JsonObject,
    existing?: LocalEntity,
  ) {
    const selectedWorkspace = workspaceIdRef.current;
    const selectedDevice = deviceIdRef.current;
    if (
      session.status !== "authenticated" ||
      database.current === null ||
      vault.current === null ||
      !selectedWorkspace ||
      !selectedDevice
    ) {
      throw new Error("locked");
    }
    const now = new Date().toISOString();
    return new ProtectedOfflineRepository(
      database.current,
      vault.current,
    ).commitMutation({
      base_version: existing?.server_version ?? 0,
      client_occurred_at: now,
      created_at: existing?.created_at ?? now,
      created_by: existing?.created_by ?? session.user.id,
      deleted_at: null,
      device_id: selectedDevice,
      entity_id: entityId,
      entity_type: entityType,
      local_revision: (existing?.local_revision ?? 0) + 1,
      operation_id: crypto.randomUUID(),
      operation_type: existing ? "update" : "create",
      payload,
      protocol_version: "sync-v1",
      updated_at: now,
      updated_by: session.user.id,
      workspace_id: selectedWorkspace,
    });
  }

  async function createNote(input: {
    markdownBody: string;
    title: string;
  }): Promise<string | null> {
    const title = input.title.trim();
    if (!title || !spaceId) return null;
    const noteId = crypto.randomUUID();
    setCommandPhase("pending");
    try {
      await commit("note", noteId, {
        markdown_body: input.markdownBody,
        space_id: spaceId,
        task_id: null,
        title,
      });
      setSelectedNoteId(noteId);
      const synchronized = await synchronizeCore();
      setCommandPhase(synchronized ? "success" : "idle");
      return noteId;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setCommandPhase("idle");
      await refresh(
        database.current,
        vault.current,
        workspaceIdRef.current,
      ).catch(() => undefined);
      return null;
    }
  }

  async function saveNote(
    noteId: string,
    input: { markdownBody: string; title: string },
  ): Promise<boolean> {
    const note = notes.find((item) => item.entity.entity_id === noteId);
    if (!note) return false;
    const title = input.title.trim();
    if (!title) return false;
    setCommandPhase("pending");
    try {
      const hasYjsState =
        database.current !== null &&
        (await database.current.entities.get([
          workspaceIdRef.current,
          "note_document_state",
          noteDocumentStateId(workspaceIdRef.current, noteId),
        ])) !== undefined;
      const mode = recordsNoteSaveMode({
        bodyChanged: input.markdownBody !== note.payload.markdown_body,
        hasYjsState,
        titleChanged: title !== note.payload.title,
      });
      if (mode === "yjs") {
        if (
          session.status !== "authenticated" ||
          database.current === null ||
          vault.current === null
        ) {
          throw new Error("locked");
        }
        await new YjsNoteRepository(
          database.current,
          vault.current,
        ).commitMarkdown({
          client_occurred_at: new Date().toISOString(),
          device_id: deviceIdRef.current,
          next_markdown: input.markdownBody,
          note_id: noteId,
          operation_id: crypto.randomUUID(),
          updated_by: session.user.id,
          workspace_id: workspaceIdRef.current,
        });
      } else if (mode === "commit") {
        await commit(
          "note",
          noteId,
          {
            markdown_body: input.markdownBody,
            space_id: spaceId,
            task_id: note.payload.task_id,
            title,
          },
          note.entity,
        );
      }
      const synchronized = await synchronizeCore();
      setCommandPhase(synchronized ? "success" : "idle");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setCommandPhase("idle");
      await refresh(
        database.current,
        vault.current,
        workspaceIdRef.current,
      ).catch(() => undefined);
      return false;
    }
  }

  async function createResource(input: RecordsResourceInput): Promise<boolean> {
    const title = input.title.trim();
    const sourceUrl = input.sourceUrl?.trim() ?? "";
    if (
      !title ||
      !spaceId ||
      (input.resourceType === "link" &&
        safeRecordsExternalUrl(sourceUrl) === null)
    ) {
      setStatus("请输入名称和有效的 HTTP(S) 地址。");
      return false;
    }
    const page = Number(input.page ?? 0);
    const pageCount = Number(input.pageCount ?? 0);
    if (
      input.resourceType === "pdf_index" &&
      (!input.pdfFilename?.trim() ||
        page < 1 ||
        pageCount < 1 ||
        page > pageCount)
    ) {
      setStatus("请输入有效的 PDF 文件名、总页数与索引页。");
      return false;
    }
    const payload: RecordsResourcePayload = {
      page_count: input.resourceType === "pdf_index" ? pageCount : null,
      page_index:
        input.resourceType === "pdf_index"
          ? [
              {
                label: input.label?.trim() ?? "",
                note: input.note?.trim() ?? "",
                page,
              },
            ]
          : [],
      pdf_filename:
        input.resourceType === "pdf_index"
          ? (input.pdfFilename?.trim() ?? "")
          : null,
      resource_type: input.resourceType,
      sha256: null,
      source_url: input.resourceType === "link" ? sourceUrl : null,
      space_id: spaceId,
      task_id: null,
      title,
    };
    setCommandPhase("pending");
    try {
      await commit("resource", crypto.randomUUID(), payload);
      const synchronized = await synchronizeCore();
      setCommandPhase(synchronized ? "success" : "idle");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setCommandPhase("idle");
      await refresh(
        database.current,
        vault.current,
        workspaceIdRef.current,
      ).catch(() => undefined);
      return false;
    }
  }

  async function renameResource(
    resourceId: string,
    title: string,
  ): Promise<boolean> {
    const resource = resources.find(
      (item) => item.entity.entity_id === resourceId,
    );
    const nextTitle = title.trim();
    if (!resource || !nextTitle) return false;
    setCommandPhase("pending");
    try {
      await commit(
        "resource",
        resourceId,
        { ...resource.payload, title: nextTitle },
        resource.entity,
      );
      const synchronized = await synchronizeCore();
      setCommandPhase(synchronized ? "success" : "idle");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setCommandPhase("idle");
      await refresh(
        database.current,
        vault.current,
        workspaceIdRef.current,
      ).catch(() => undefined);
      return false;
    }
  }

  async function queueAttachment(noteId: string, file: File): Promise<boolean> {
    const db = database.current;
    if (
      db === null ||
      !workspaceIdRef.current ||
      !spaceId ||
      !deviceIdRef.current ||
      !noteId ||
      file.size === 0
    ) {
      setStatus("请选择已有笔记和一个受支持的附件。");
      return false;
    }
    setCommandPhase("pending");
    try {
      await new AttachmentQueueRepository(db).enqueue({
        attachment_id: crypto.randomUUID(),
        blob: file,
        device_id: deviceIdRef.current,
        filename: file.name,
        media_type: file.type,
        space_id: spaceId,
        target_id: noteId,
        target_type: "note",
        workspace_id: workspaceIdRef.current,
      });
      setIssue(null);
      setStatus("附件已进入真实上传队列；可在同步中心上传并完成哈希验证。");
      await refresh(db, vault.current, workspaceIdRef.current).catch(
        () => undefined,
      );
      setCommandPhase("success");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setCommandPhase("idle");
      return false;
    }
  }

  async function unlock(passphrase: string): Promise<boolean> {
    if (
      session.status !== "authenticated" ||
      !passphrase ||
      !workspaceIdRef.current ||
      !deviceIdRef.current
    ) {
      return false;
    }
    const selectedWorkspace = workspaceIdRef.current;
    const selectedDevice = deviceIdRef.current;
    setCommandPhase("pending");
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault, selectedWorkspace, selectedDevice);
      await refresh(db, localVault, selectedWorkspace);
      if (selectedWorkspace === workspaceIdRef.current) {
        setIssue(null);
        setStatus(
          "已在应用内解锁。安全预览只渲染 Markdown 结构，不执行 HTML。",
        );
      }
      setCommandPhase("success");
      return true;
    } catch (error) {
      if (selectedWorkspace === workspaceIdRef.current) {
        setIssue(issueFrom(error));
        setStatus(userMessage(error));
      }
      setCommandPhase("idle");
      return false;
    }
  }

  function setWorkspaceId(nextWorkspaceId: string) {
    if (nextWorkspaceId === workspaceIdRef.current) return;
    workspaceIdRef.current = nextWorkspaceId;
    spaceRequest.current += 1;
    recordsRequest.current += 1;
    setWorkspaceIdState(nextWorkspaceId);
    setSpaceIdState("");
    setSpaces([]);
    setNotes([]);
    setResources([]);
    setAttachments([]);
    setConflictCount(0);
    setSelectedNoteId("");
    setDataPhase("idle");
    setCommandPhase("idle");
    setIssue(null);
  }

  function setSpaceId(nextSpaceId: string) {
    setSpaceIdState(nextSpaceId);
    setSelectedNoteId("");
    setCommandPhase("idle");
  }

  const viewModel = useMemo(
    () =>
      deriveRecordsViewModel({
        attachments,
        notes,
        resources,
        selectedNoteId,
        spaceId,
      }),
    [attachments, notes, resources, selectedNoteId, spaceId],
  );
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const selectedSpace = spaces.find((item) => item.id === spaceId);
  const canWrite = !["reviewer", "viewer"].includes(
    selectedWorkspace?.role ?? "viewer",
  );
  const stale =
    [...viewModel.notes, ...viewModel.resources].some(
      (item) => item.entity.sync_status !== "clean",
    ) || viewModel.attachments.some((item) => item.state !== "verified");
  const hasData =
    viewModel.notes.length +
      viewModel.resources.length +
      viewModel.attachments.length >
    0;
  const operationalKind =
    deriveRecordsOperationalKind({
      commandPhase,
      conflictCount,
      contextPhase,
      dataPhase,
      deviceAvailable: Boolean(deviceId),
      hasContext: Boolean(workspaceId && spaceId),
      hasData,
      issueKind: issue?.kind,
      online,
      stale,
      unlocked,
    }) ?? (canWrite ? null : "permission");
  const recoveryByKind: Record<
    Exclude<ProductOperationalStateKind, "pending" | "permission" | "success">,
    ProductOperationalState["recovery"]
  > = {
    "capability-disabled": {
      href: "/app/security",
      kind: "link",
      label: "检查当前设备",
    },
    conflict: { href: "/app/sync", kind: "link", label: "处理同步冲突" },
    empty: { href: "#records-new-note", kind: "link", label: "新建笔记" },
    error: {
      kind: "button",
      label: "重新读取",
      onInvoke: () => void loadContext(),
    },
    loading: {
      disabled: true,
      kind: "button",
      label: "正在读取",
      onInvoke: () => undefined,
    },
    locked: {
      href: "#records-unlock",
      kind: "link",
      label: "解锁本地资料",
    },
    offline: { href: "/app/sync", kind: "link", label: "查看离线队列" },
    stale: {
      kind: "button",
      label: "立即同步",
      onInvoke: () => void synchronize(),
    },
  };
  const operationalState = operationalKind
    ? ({
        kind: operationalKind,
        recovery:
          operationalKind === "pending" || operationalKind === "success"
            ? { href: "/app/sync", kind: "link", label: "查看同步状态" }
            : operationalKind === "permission"
              ? {
                  href: "/app/workspaces",
                  kind: "link",
                  label: "查看成员权限",
                }
              : recoveryByKind[operationalKind],
        requestId: issue?.requestId,
      } as ProductOperationalState)
    : null;
  const operational: WorkbenchOperationalContext = {
    permission: selectedWorkspace
      ? {
          label: selectedWorkspace.role,
          tone: canWrite ? "good" : "warn",
        }
      : undefined,
    space: selectedSpace
      ? { id: selectedSpace.id, name: selectedSpace.name }
      : undefined,
    sync: {
      label:
        conflictCount > 0
          ? `${conflictCount} 项冲突`
          : stale
            ? "待同步"
            : "已同步",
      tone: conflictCount > 0 || stale ? "warn" : "good",
    },
    vault: {
      label: unlocked ? "已解锁" : "已锁定",
      tone: unlocked ? "good" : "warn",
    },
    workspace: selectedWorkspace
      ? { id: selectedWorkspace.id, name: selectedWorkspace.name }
      : undefined,
  };

  return {
    capabilities: {
      canCreate: canWrite && unlocked && Boolean(spaceId && deviceId),
      canSync: unlocked && Boolean(workspaceId && deviceId),
      canUnlock: Boolean(workspaceId && deviceId),
      canWrite,
    },
    commands: {
      createNote,
      createResource,
      loadContext,
      queueAttachment,
      renameResource,
      saveNote,
      selectNote: setSelectedNoteId,
      setSpaceId,
      setWorkspaceId,
      synchronize,
      unlock,
    },
    context: {
      online,
      operational,
      operationalState,
      spaceId,
      spaces,
      status,
      unlocked,
      workspaceId,
      workspaces,
    },
    viewModel: { ...viewModel, conflictCount },
  };
}
