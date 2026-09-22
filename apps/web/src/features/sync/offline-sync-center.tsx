"use client";

import { feedback, feedbackErrorText } from "@/lib/feedback";
import { incompleteSyncMessage } from "@/features/sync/sync-diagnostics";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  AttachmentQueueRepository,
  BootstrapRepository,
  canResumeSync,
  ConflictRepository,
  OfflineStorageError,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
  type AttachmentQueueEntry,
  type JsonObject,
  type LocalConflict,
  type LogionOfflineDatabase,
  type OutboxEntry,
  type SyncTransport,
  type WorkspaceSyncState,
} from "@logion/offline";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useSession } from "@/features/auth/session-provider";
import {
  offlineCapabilityMessage,
  offlineUnlockMessage,
} from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { LogionApiError, type ApiClient } from "@/lib/api/client";

import { ApiAttachmentUploadTransport } from "./attachment-upload-transport";
import { summarizeSyncQueue, type SyncQueueSummary } from "./sync-diagnostics";
import { SyncWorkbench } from "./sync-workbench";
import { useSyncController } from "./use-sync-controller";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type ConnectionState = "offline" | "online";
type PermissionIssue = "permission" | "error" | null;

const CLEAR_DEVICE_CONFIRMATION = "CLEAR THIS DEVICE";
const EMPTY_QUEUE_SUMMARY = summarizeSyncQueue([]);

export interface ConflictView {
  conflict: LocalConflict;
  local: JsonObject;
  remote: JsonObject;
}

function currentConnection(): ConnectionState {
  return navigator.onLine ? "online" : "offline";
}

function userMessage(error: unknown): string {
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null) return capabilityMessage;
  if (error instanceof LogionApiError) {
    return feedbackErrorText(error);
  }
  if (error instanceof OfflineStorageError) {
    return feedbackErrorText(
      error,
      "本地资料操作未完成；本设备上的既有数据保持不变。",
    );
  }
  return "操作未完成；本地数据保持不变，请检查解锁状态或稍后重试。";
}

function attachmentFailureMessage(
  attachment: AttachmentQueueEntry,
  apiError: LogionApiError | null,
): string {
  const code =
    apiError?.code ??
    attachment.last_error_code ??
    "OFFLINE_ATTACHMENT_UPLOAD_FAILED";
  const request = apiError ? `；请求编号：${apiError.requestId}` : "";
  const evidence = `（${code}${request}）`;

  switch (code) {
    case "KNOWLEDGE_ATTACHMENT_INGEST_DISABLED":
      return `附件「${attachment.filename}」上传失败：服务端附件功能当前未开放，本地文件保留在队列中${evidence}。`;
    case "OFFLINE_ATTACHMENT_METADATA_REQUIRED":
      return `附件「${attachment.filename}」未上传：需补全目标对象信息，本地文件保留在队列中${evidence}。`;
    case "OFFLINE_ATTACHMENT_VERIFICATION_FAILED":
      return `附件「${attachment.filename}」上传失败：服务器未确认哈希，本地文件保留在队列中，请重试${evidence}。`;
    default:
      return `附件「${attachment.filename}」上传失败：本地文件保留在队列中，请检查错误码后重试${evidence}。`;
  }
}

function transport(
  apiRequest: ApiClient["request"],
  workspaceId: string,
): SyncTransport {
  return {
    push: (syncRequest) =>
      apiRequest(`/api/v1/workspaces/${workspaceId}/sync/push`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify(syncRequest),
      }),
    pull: (syncRequest) =>
      apiRequest(`/api/v1/workspaces/${workspaceId}/sync/pull`, {
        method: "POST",
        body: JSON.stringify(syncRequest),
      }),
  };
}

function reference(payload: JsonObject): string | null {
  const value = payload.encrypted_payload_ref;
  return typeof value === "string" ? value : null;
}

async function reveal(
  vault: OfflineVault,
  workspaceId: string,
  payload: JsonObject,
): Promise<JsonObject> {
  const recordId = reference(payload);
  if (recordId === null) return payload;
  const revealed = await vault.get(recordId, workspaceId);
  if (revealed === null) throw new Error("conflict payload unavailable");
  return revealed;
}

export function OfflineSyncCenter() {
  const { request } = useSyncController();
  const { state: session } = useSession();
  const {
    clearLocalData,
    database,
    markChanged,
    lock: lockVault,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const unlocked = vaultPhase === "unlocked";
  const [status, setStatus] = useState("正在读取同步上下文…");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessIssue, setAccessIssue] = useState<PermissionIssue>(null);
  const [syncing, setSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictView[]>([]);
  const [attachments, setAttachments] = useState<AttachmentQueueEntry[]>([]);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [queueSummary, setQueueSummary] =
    useState<SyncQueueSummary>(EMPTY_QUEUE_SUMMARY);
  const [syncState, setSyncState] = useState<WorkspaceSyncState | null>(null);
  const [mergeConflictId, setMergeConflictId] = useState<string | null>(null);
  const [mergeDraft, setMergeDraft] = useState("");
  const [clearConfirmation, setClearConfirmation] = useState("");
  const contextVersion = useRef(0);
  const mergeVersion = useRef(0);
  const unlockRequest = useRef(0);
  const contextRequest = useRef(0);
  useLayoutEffect(() => {
    unlockRequest.current += 1;
  }, [workspaceId, deviceId]);
  const refreshRequest = useRef(0);
  const currentWorkspace = useRef("");
  const [loadedWorkspace, setLoadedWorkspace] = useState("");
  const [dataError, setDataError] = useState(false);
  useLayoutEffect(() => {
    currentWorkspace.current = workspaceId;
    contextVersion.current += 1;
    refreshRequest.current += 1;
    const generation = contextVersion.current;
    queueMicrotask(() => {
      if (generation !== contextVersion.current) return;
      setLoadedWorkspace("");
      setDataError(false);
      setStatus(unlocked ? "正在读取本地同步状态…" : "本地资料已锁定。");
      setConflicts([]);
      setAttachments([]);
      setOutbox([]);
      setQueueSummary(EMPTY_QUEUE_SUMMARY);
      setSyncState(null);
      setMergeConflictId(null);
      setMergeDraft("");
      setSyncing(false);
      setUploading(false);
    });
    return () => {
      contextVersion.current += 1;
      refreshRequest.current += 1;
    };
  }, [workspaceId, deviceId, unlocked]);

  const loadContext = useCallback(async () => {
    const requestId = ++contextRequest.current;
    setLoading(true);
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        request<{ workspaces: Workspace[] }>("/api/v1/workspaces"),
        request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      if (requestId !== contextRequest.current) return;
      const currentDevice = deviceResult.devices.find((item) => item.current);
      setWorkspaces(workspaceResult.workspaces);
      setDevices(deviceResult.devices);
      setAccessIssue(null);
      const requestedWorkspace = new URLSearchParams(
        window.location.search,
      ).get("workspace");
      setWorkspaceId((current) =>
        workspaceResult.workspaces.some((item) => item.id === current)
          ? current
          : (workspaceResult.workspaces.find(
              (item) => item.id === requestedWorkspace,
            )?.id ??
            workspaceResult.workspaces[0]?.id ??
            ""),
      );
      setDeviceId(currentDevice?.id ?? "");
      setStatus(
        currentDevice
          ? "请选择工作区并解锁本地资料。"
          : "没有找到当前设备，无法安全同步。",
      );
    } catch (error) {
      if (requestId !== contextRequest.current) return;
      setAccessIssue(
        error instanceof LogionApiError &&
          (error.status === 401 || error.status === 403)
          ? "permission"
          : "error",
      );
      setStatus(userMessage(error));
    } finally {
      if (requestId === contextRequest.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const update = () => setConnection(currentConnection());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    queueMicrotask(() => void loadContext());
    return () => {
      contextRequest.current += 1;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [loadContext]);

  async function bootstrap(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
    isCurrent: () => boolean,
  ): Promise<void> {
    const current = await db.syncState.get(workspaceId);
    if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
    if (canResumeSync(current, deviceId)) return;
    const repository = new BootstrapRepository(db, {}, localVault);
    const first = await request<unknown>(
      `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
      {
        method: "POST",
        body: JSON.stringify({
          message_type: "bootstrap_request",
          protocol_version: "sync-v1",
          workspace_id: workspaceId,
          device_id: deviceId,
          known_sync_epoch: current?.sync_epoch ?? null,
          snapshot_id: null,
          chunk_index: null,
        }),
      },
    );
    if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
    const validation = validateSyncV1Message(first);
    if (
      !validation.ok ||
      validation.value.message_type !== "bootstrap_response"
    ) {
      throw new Error("invalid bootstrap response");
    }
    const manifest = validation.value;
    await repository.prepareDeviceRebootstrap(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
    await repository.stageChunk(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < manifest.chunk_count; index += 1) {
      if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
      const chunk = await request<unknown>(
        `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
        {
          method: "POST",
          body: JSON.stringify({
            message_type: "bootstrap_request",
            protocol_version: "sync-v1",
            workspace_id: workspaceId,
            device_id: deviceId,
            known_sync_epoch: manifest.sync_epoch,
            snapshot_id: manifest.snapshot_id,
            chunk_index: index,
          }),
        },
      );
      if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
      await repository.stageChunk(chunk, {
        workspace_id: workspaceId,
        device_id: deviceId,
      });
    }
    if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
    markChanged();
  }

  async function refresh(
    db = database.current,
    localVault = vault.current,
  ): Promise<void> {
    if (
      db === null ||
      localVault === null ||
      !workspaceId ||
      db !== database.current ||
      localVault !== vault.current ||
      workspaceId !== currentWorkspace.current
    )
      return;
    const requestId = ++refreshRequest.current;
    setDataError(false);
    try {
      const [rows, queued, outbox, currentSyncState] = await Promise.all([
        new ConflictRepository(db, localVault).listOpen(workspaceId),
        db.attachmentQueue.where("workspace_id").equals(workspaceId).toArray(),
        db.outbox.where("workspace_id").equals(workspaceId).toArray(),
        db.syncState.get(workspaceId),
      ]);
      const views = await Promise.all(
        rows.map(async (conflict) => ({
          conflict,
          local: await reveal(localVault, workspaceId, conflict.local_payload),
          remote: await reveal(
            localVault,
            workspaceId,
            conflict.remote_payload,
          ),
        })),
      );
      if (
        requestId !== refreshRequest.current ||
        workspaceId !== currentWorkspace.current ||
        db !== database.current ||
        localVault !== vault.current
      )
        return;
      setLoadedWorkspace(workspaceId);
      setConflicts(views);
      setAttachments(
        queued
          .filter((entry) => entry.state !== "verified")
          .sort(
            (left, right) =>
              left.queued_at.localeCompare(right.queued_at) ||
              left.attachment_id.localeCompare(right.attachment_id),
          ),
      );
      setQueueSummary(summarizeSyncQueue(outbox));
      setOutbox(outbox);
      setSyncState(currentSyncState ?? null);
    } catch (error) {
      if (
        requestId === refreshRequest.current &&
        workspaceId === currentWorkspace.current &&
        db === database.current &&
        localVault === vault.current
      ) {
        setLoadedWorkspace("");
        setDataError(true);
        throw error;
      }
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (session.status !== "authenticated" || !workspaceId || !deviceId) return;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    const requestId = ++unlockRequest.current;
    const current = () =>
      requestId === unlockRequest.current &&
      workspaceId === currentWorkspace.current;
    let available: (() => boolean) | null = null;
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      available = () =>
        current() && db === database.current && localVault === vault.current;
      if (!current() || db !== database.current || localVault !== vault.current)
        return;
      await bootstrap(db, localVault, available);
      await refresh(db, localVault);
      if (!current() || db !== database.current || localVault !== vault.current)
        return;
      setStatus("本地资料已解锁；冲突正文只在当前页面内存中显示。");
      form.reset();
    } catch (error) {
      if (!current() || (available !== null && !available())) return;
      setStatus(offlineUnlockMessage(error) ?? userMessage(error));
    }
  }

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    const generation = contextVersion.current;
    const current = () =>
      generation === contextVersion.current &&
      db === database.current &&
      localVault === vault.current;
    queueMicrotask(
      () =>
        void refresh(db, localVault)
          .then(() => {
            if (current()) setStatus("本地资料已在应用内解锁。");
          })
          .catch((error: unknown) => {
            if (current()) setStatus(feedback.error(userMessage(error)));
          }),
    );
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId, deviceId]);

  function lock() {
    lockVault();
    setConflicts([]);
    setAttachments([]);
    setOutbox([]);
    setQueueSummary(EMPTY_QUEUE_SUMMARY);
    setSyncState(null);
    setMergeConflictId(null);
    setMergeDraft("");
    setStatus("本地资料已锁定。");
  }

  async function clearThisDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (clearConfirmation !== CLEAR_DEVICE_CONFIRMATION) return;
    setStatus("正在清除此账户在本设备上的离线数据…");
    try {
      await clearLocalData();
      setConflicts([]);
      setAttachments([]);
      setOutbox([]);
      setQueueSummary(EMPTY_QUEUE_SUMMARY);
      setSyncState(null);
      setMergeConflictId(null);
      setMergeDraft("");
      setClearConfirmation("");
      setStatus(
        feedback.success("本设备上的离线数据已清除；服务器数据没有改变。"),
      );
    } catch (error) {
      setStatus(feedback.error(userMessage(error)));
    }
  }

  async function synchronize(): Promise<void> {
    const db = database.current,
      localVault = vault.current;
    const generation = contextVersion.current;
    const current = () =>
      generation === contextVersion.current &&
      workspaceId === currentWorkspace.current &&
      db === database.current &&
      localVault === vault.current;
    if (!db || !localVault || !workspaceId || !deviceId || !current()) return;
    setSyncing(true);
    try {
      await bootstrap(db, localVault, current);
      if (!current()) return;
      const result = await new SyncClient(
        db,
        transport(request, workspaceId),
        localVault,
      ).synchronize(workspaceId, deviceId);
      const remaining = await db.outbox
        .where("workspace_id")
        .equals(workspaceId)
        .toArray();
      if (!current()) return;
      const incomplete = incompleteSyncMessage(result, remaining);
      setStatus(
        incomplete
          ? feedback.error(incomplete)
          : feedback.success("同步完成；仍需选择的冲突会继续保留。 "),
      );
    } catch (error) {
      if (current()) setStatus(feedback.error(userMessage(error)));
    } finally {
      if (current()) {
        await refresh(db, localVault).catch((error: unknown) => {
          if (current()) setStatus(feedback.error(userMessage(error)));
        });
        if (current()) setSyncing(false);
      }
    }
  }

  function operationIsCurrent() {
    const generation = contextVersion.current;
    const db = database.current;
    const localVault = vault.current;
    return () =>
      generation === contextVersion.current &&
      workspaceId === currentWorkspace.current &&
      db !== null &&
      localVault !== null &&
      db === database.current &&
      localVault === vault.current;
  }

  async function resolve(
    view: ConflictView,
    resolution: "keep_local" | "keep_remote" | "merge",
  ) {
    const isCurrent = operationIsCurrent();
    const draftVersion = mergeVersion.current;
    const db = database.current;
    const localVault = vault.current;
    if (
      db === null ||
      localVault === null ||
      session.status !== "authenticated"
    )
      return;
    try {
      let mergedPayload: JsonObject | undefined;
      if (resolution === "merge") {
        const parsed: unknown = JSON.parse(mergeDraft);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        )
          throw new Error("merge must be an object");
        mergedPayload = parsed as JsonObject;
      }
      if (!isCurrent()) return;
      await new ConflictRepository(db, localVault).queueResolution({
        workspace_id: workspaceId,
        conflict_id: view.conflict.conflict_id,
        operation_id: crypto.randomUUID(),
        device_id: deviceId,
        updated_by: session.user.id,
        client_occurred_at: new Date().toISOString(),
        resolution,
        merged_payload: mergedPayload,
      });
      if (!isCurrent()) return;
      if (draftVersion === mergeVersion.current) {
        setMergeConflictId(null);
        setMergeDraft("");
      }
      if (!isCurrent()) return;
      setStatus("解决方案已安全写入本地 Outbox，正在尝试同步。");
      await synchronize();
    } catch (error) {
      if (!isCurrent()) return;
      setStatus(feedback.error(userMessage(error)));
      await refresh(db, localVault);
    }
  }

  async function copyLocal(view: ConflictView) {
    const isCurrent = operationIsCurrent();
    const db = database.current;
    const localVault = vault.current;
    if (
      db === null ||
      localVault === null ||
      session.status !== "authenticated" ||
      !["note", "resource"].includes(view.conflict.entity_type)
    )
      return;
    const now = new Date().toISOString();
    try {
      await new ProtectedOfflineRepository(db, localVault).commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: view.conflict.entity_type as "note" | "resource",
        entity_id: crypto.randomUUID(),
        operation_type: "create",
        base_version: 0,
        local_revision: 1,
        client_occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: session.user.id,
        updated_by: session.user.id,
        payload: view.local,
      });
      if (!isCurrent()) return;
      await new ConflictRepository(db, localVault).queueResolution({
        workspace_id: workspaceId,
        conflict_id: view.conflict.conflict_id,
        operation_id: crypto.randomUUID(),
        device_id: deviceId,
        updated_by: session.user.id,
        client_occurred_at: now,
        resolution: "keep_remote",
      });
      if (!isCurrent()) return;
      setStatus("已复制本地版本为新对象；原对象将采用服务器版本。");
      await synchronize();
    } catch (error) {
      if (!isCurrent()) return;
      setStatus(feedback.error(userMessage(error)));
      await refresh(db, localVault);
    }
  }

  async function dismiss(view: ConflictView) {
    const isCurrent = operationIsCurrent();
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return;
    try {
      if (!isCurrent()) return;
      await new ConflictRepository(db, localVault).dismiss(
        workspaceId,
        view.conflict.conflict_id,
      );
      if (!isCurrent()) return;
      setStatus(
        feedback.success("冲突已暂不处理；本地版本与服务器版本均未被覆盖。 "),
      );
      await refresh(db, localVault);
    } catch (error) {
      if (!isCurrent()) return;
      setStatus(feedback.error(userMessage(error)));
      await refresh(db, localVault);
    }
  }

  async function removeAttachment(
    attachment: AttachmentQueueEntry,
  ): Promise<void> {
    const generation = contextVersion.current;
    const current = () => generation === contextVersion.current;
    try {
      const db = database.current;
      if (
        db === null ||
        !unlocked ||
        uploading ||
        attachment.workspace_id !== workspaceId
      ) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      await new AttachmentQueueRepository(db).removeFailed(
        workspaceId,
        attachment.attachment_id,
      );
      if (!current()) return;
      setAttachments((current) =>
        current.filter(
          (entry) => entry.attachment_id !== attachment.attachment_id,
        ),
      );
      setStatus(
        feedback.success(`已从本设备队列移除附件「${attachment.filename}」。`),
      );
    } catch (error) {
      if (!current()) return;
      let message = userMessage(error);
      try {
        await refresh();
        if (
          error instanceof OfflineStorageError &&
          error.code === "OFFLINE_INPUT_INVALID"
        ) {
          message = "附件已不可移除，已重新读取当前队列。";
        }
      } catch (refreshError) {
        message = `${message} 队列读取失败：${userMessage(refreshError)}`;
      }
      if (!current()) return;
      setStatus(feedback.error(message));
      throw new Error(message);
    }
  }

  async function upload(attachment: AttachmentQueueEntry) {
    const db = database.current;
    const generation = contextVersion.current;
    const current = () =>
      generation === contextVersion.current && db === database.current;
    if (
      db === null ||
      uploading ||
      !unlocked ||
      attachment.workspace_id !== workspaceId
    )
      return;
    setUploading(true);
    const repository = new AttachmentQueueRepository(db);
    const uploadTransport = new ApiAttachmentUploadTransport();
    try {
      if (attachment.state === "failed") {
        await repository.retry(attachment.attachment_id);
      }
      const result = await repository.uploadPending(
        workspaceId,
        uploadTransport,
        attachment.attachment_id,
      );
      if (!current()) return;
      if (result === null) {
        setStatus(feedback.error("附件队列中没有待上传项。"));
      } else if (result.state === "verified") {
        setStatus(
          feedback.success(
            `附件「${result.filename}」上传成功，并完成服务器哈希验证。`,
          ),
        );
      } else {
        setStatus(
          feedback.error(
            attachmentFailureMessage(result, uploadTransport.lastError),
          ),
        );
      }
    } catch (error) {
      if (current()) setStatus(feedback.error(userMessage(error)));
    } finally {
      if (current()) {
        try {
          await refresh();
        } catch (error) {
          if (current()) setStatus(feedback.error(userMessage(error)));
        } finally {
          if (current()) setUploading(false);
        }
      }
    }
  }

  const visible = unlocked && loadedWorkspace === workspaceId;
  return (
    <SyncWorkbench
      uploading={uploading}
      accessIssue={accessIssue}
      attachments={visible ? attachments : []}
      clearConfirmation={clearConfirmation}
      connection={connection}
      conflicts={visible ? conflicts : []}
      deviceId={deviceId}
      devices={devices}
      lock={lock}
      loading={loading}
      dataLoading={unlocked && !visible && !dataError}
      dataError={dataError}
      mergeConflictId={visible ? mergeConflictId : null}
      mergeDraft={visible ? mergeDraft : ""}
      onClearConfirmationChange={setClearConfirmation}
      onClearDevice={clearThisDevice}
      onCopyLocal={(view) => void copyLocal(view)}
      onDismiss={(view) => void dismiss(view)}
      onMergeDraftChange={(draft) => {
        mergeVersion.current += 1;
        setMergeDraft(draft);
      }}
      onMergeOpen={(view) => {
        mergeVersion.current += 1;
        setMergeConflictId(view.conflict.conflict_id);
        setMergeDraft(JSON.stringify(view.local, null, 2));
      }}
      onMergeOpenChange={(open) => {
        mergeVersion.current += 1;
        if (!open) {
          setMergeConflictId(null);
          setMergeDraft("");
        }
      }}
      onResolve={(view, resolution) => void resolve(view, resolution)}
      onSynchronize={() => void synchronize()}
      onUnlock={(event) => void unlock(event)}
      onUpload={(attachment) => void upload(attachment)}
      onWorkspaceChange={(id) => {
        unlockRequest.current += 1;
        contextVersion.current += 1;
        currentWorkspace.current = id;
        setWorkspaceId(id);
      }}
      onReload={() => void loadContext()}
      onRemoveAttachment={removeAttachment}
      outbox={visible ? outbox : []}
      queueSummary={visible ? queueSummary : EMPTY_QUEUE_SUMMARY}
      status={status}
      syncState={visible ? syncState : null}
      syncing={syncing}
      unlocked={unlocked}
      vaultPhase={vaultPhase}
      workspaceId={workspaceId}
      workspaces={workspaces}
    />
  );
}
