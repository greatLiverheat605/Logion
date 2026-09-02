"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  AttachmentQueueRepository,
  BootstrapRepository,
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
import { type FormEvent, useCallback, useEffect, useState } from "react";

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
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  if (error instanceof OfflineStorageError) {
    return "本地资料操作未完成；本设备上的既有数据保持不变。";
  }
  return "操作未完成；本地数据保持不变，请检查解锁状态或稍后重试。";
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

  const loadContext = useCallback(async () => {
    setLoading(true);
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        request<{ workspaces: Workspace[] }>("/api/v1/workspaces"),
        request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      const currentDevice = deviceResult.devices.find((item) => item.current);
      setWorkspaces(workspaceResult.workspaces);
      setDevices(deviceResult.devices);
      setAccessIssue(null);
      setWorkspaceId((current) =>
        workspaceResult.workspaces.some((item) => item.id === current)
          ? current
          : (workspaceResult.workspaces[0]?.id ?? ""),
      );
      setDeviceId(currentDevice?.id ?? "");
      setStatus(
        currentDevice
          ? "请选择工作区并解锁本地资料。"
          : "没有找到当前设备，无法安全同步。",
      );
    } catch (error) {
      setAccessIssue(
        error instanceof LogionApiError &&
          (error.status === 401 || error.status === 403)
          ? "permission"
          : "error",
      );
      setStatus(userMessage(error));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const update = () => setConnection(currentConnection());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    queueMicrotask(() => void loadContext());
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [loadContext]);

  async function bootstrap(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
  ): Promise<void> {
    const current = await db.syncState.get(workspaceId);
    if (current?.bootstrap_state === "ready" && current.device_id === deviceId)
      return;
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
    const validation = validateSyncV1Message(first);
    if (
      !validation.ok ||
      validation.value.message_type !== "bootstrap_response"
    ) {
      throw new Error("invalid bootstrap response");
    }
    const manifest = validation.value;
    await repository.stageChunk(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < manifest.chunk_count; index += 1) {
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
      await repository.stageChunk(chunk, {
        workspace_id: workspaceId,
        device_id: deviceId,
      });
    }
  }

  async function refresh(
    db = database.current,
    localVault = vault.current,
  ): Promise<void> {
    if (db === null || localVault === null || !workspaceId) return;
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
        remote: await reveal(localVault, workspaceId, conflict.remote_payload),
      })),
    );
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
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId) return;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus("本地资料已解锁；冲突正文只在当前页面内存中显示。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(offlineUnlockMessage(error) ?? userMessage(error));
    }
  }

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    queueMicrotask(
      () =>
        void refresh(db, localVault)
          .then(() => setStatus("本地资料已在应用内解锁。"))
          .catch((error: unknown) => setStatus(userMessage(error))),
    );
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId]);

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
      setStatus("本设备上的离线数据已清除；服务器数据没有改变。");
    } catch (error) {
      setStatus(userMessage(error));
    }
  }

  async function synchronize(): Promise<void> {
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null || !workspaceId || !deviceId) return;
    setSyncing(true);
    try {
      await bootstrap(db, localVault);
      await new SyncClient(
        db,
        transport(request, workspaceId),
        localVault,
      ).synchronize(workspaceId, deviceId);
      setStatus("同步完成；仍需选择的冲突会继续保留。 ");
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      await refresh(db, localVault);
      setSyncing(false);
    }
  }

  async function resolve(
    view: ConflictView,
    resolution: "keep_local" | "keep_remote" | "merge",
  ) {
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
      setMergeConflictId(null);
      setMergeDraft("");
      setStatus("解决方案已安全写入本地 Outbox，正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(userMessage(error));
      await refresh(db, localVault);
    }
  }

  async function copyLocal(view: ConflictView) {
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
      await new ConflictRepository(db, localVault).queueResolution({
        workspace_id: workspaceId,
        conflict_id: view.conflict.conflict_id,
        operation_id: crypto.randomUUID(),
        device_id: deviceId,
        updated_by: session.user.id,
        client_occurred_at: now,
        resolution: "keep_remote",
      });
      setStatus("已复制本地版本为新对象；原对象将采用服务器版本。");
      await synchronize();
    } catch (error) {
      setStatus(userMessage(error));
      await refresh(db, localVault);
    }
  }

  async function dismiss(view: ConflictView) {
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return;
    try {
      await new ConflictRepository(db, localVault).dismiss(
        workspaceId,
        view.conflict.conflict_id,
      );
      setStatus("冲突已暂不处理；本地版本与服务器版本均未被覆盖。 ");
      await refresh(db, localVault);
    } catch (error) {
      setStatus(userMessage(error));
      await refresh(db, localVault);
    }
  }

  async function upload(attachment: AttachmentQueueEntry) {
    const db = database.current;
    if (db === null) return;
    const repository = new AttachmentQueueRepository(db);
    try {
      if (attachment.state === "failed") {
        await repository.retry(attachment.attachment_id);
      }
      await repository.uploadPending(
        workspaceId,
        new ApiAttachmentUploadTransport(),
      );
      setStatus("附件上传队列已处理一项，并完成服务器哈希验证。");
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      await refresh();
    }
  }

  return (
    <SyncWorkbench
      accessIssue={accessIssue}
      attachments={attachments}
      clearConfirmation={clearConfirmation}
      connection={connection}
      conflicts={conflicts}
      deviceId={deviceId}
      devices={devices}
      lock={lock}
      loading={loading}
      mergeConflictId={mergeConflictId}
      mergeDraft={mergeDraft}
      onClearConfirmationChange={setClearConfirmation}
      onClearDevice={clearThisDevice}
      onCopyLocal={(view) => void copyLocal(view)}
      onDismiss={(view) => void dismiss(view)}
      onMergeDraftChange={setMergeDraft}
      onMergeOpen={(view) => {
        setMergeConflictId(view.conflict.conflict_id);
        setMergeDraft(JSON.stringify(view.local, null, 2));
      }}
      onMergeOpenChange={(open) => {
        if (!open) {
          setMergeConflictId(null);
          setMergeDraft("");
        }
      }}
      onResolve={(view, resolution) => void resolve(view, resolution)}
      onSynchronize={() => void synchronize()}
      onUnlock={(event) => void unlock(event)}
      onUpload={(attachment) => void upload(attachment)}
      onWorkspaceChange={setWorkspaceId}
      onReload={() => void loadContext()}
      outbox={outbox}
      queueSummary={queueSummary}
      status={status}
      syncState={syncState}
      syncing={syncing}
      unlocked={unlocked}
      vaultPhase={vaultPhase}
      workspaceId={workspaceId}
      workspaces={workspaces}
    />
  );
}
