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
  type SyncTransport,
  type WorkspaceSyncState,
} from "@logion/offline";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ProductEmptyState,
  ProductMetric,
  ProductTag,
} from "@/components/product/product-ui";
import { useSession } from "@/features/auth/session-provider";
import { offlineCapabilityMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { ApiAttachmentUploadTransport } from "./attachment-upload-transport";
import { summarizeSyncQueue, type SyncQueueSummary } from "./sync-diagnostics";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type ConnectionState = "offline" | "online";

const CLEAR_DEVICE_CONFIRMATION = "CLEAR THIS DEVICE";
const EMPTY_QUEUE_SUMMARY = summarizeSyncQueue([]);

interface ConflictView {
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

function transport(workspaceId: string): SyncTransport {
  return {
    push: (request) =>
      browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/push`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify(request),
      }),
    pull: (request) =>
      browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/pull`, {
        method: "POST",
        body: JSON.stringify(request),
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

function preview(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return "—";
  return encoded.length > 160 ? `${encoded.slice(0, 157)}…` : encoded;
}

function fieldDiff(view: ConflictView) {
  return Array.from(
    new Set([...Object.keys(view.local), ...Object.keys(view.remote)]),
  )
    .slice(0, 50)
    .map((field) => ({
      field,
      local: preview(view.local[field]),
      remote: preview(view.remote[field]),
      changed:
        JSON.stringify(view.local[field]) !==
        JSON.stringify(view.remote[field]),
    }))
    .filter((item) => item.changed);
}

export function OfflineSyncCenter() {
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
  const [conflicts, setConflicts] = useState<ConflictView[]>([]);
  const [attachments, setAttachments] = useState<AttachmentQueueEntry[]>([]);
  const [queueSummary, setQueueSummary] =
    useState<SyncQueueSummary>(EMPTY_QUEUE_SUMMARY);
  const [syncState, setSyncState] = useState<WorkspaceSyncState | null>(null);
  const [mergeConflictId, setMergeConflictId] = useState<string | null>(null);
  const [mergeDraft, setMergeDraft] = useState("");
  const [clearConfirmation, setClearConfirmation] = useState("");

  const loadContext = useCallback(async () => {
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      const currentDevice = deviceResult.devices.find((item) => item.current);
      setWorkspaces(workspaceResult.workspaces);
      setDevices(deviceResult.devices);
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
      setStatus(userMessage(error));
    }
  }, []);

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
    const first = await browserApiClient.request<unknown>(
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
      const chunk = await browserApiClient.request<unknown>(
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
      setStatus(userMessage(error));
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
    try {
      await bootstrap(db, localVault);
      await new SyncClient(db, transport(workspaceId), localVault).synchronize(
        workspaceId,
        deviceId,
      );
      setStatus("同步完成；仍需选择的冲突会继续保留。 ");
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      await refresh(db, localVault);
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
    <section aria-label="同步状态" className="sync-grid">
      <div className="product-metric-grid sync-wide-card">
        <ProductMetric
          label="连接状态"
          value={connection === "online" ? "在线" : "离线"}
          detail="离线编辑仍保存在本机"
          tone={connection === "online" ? "good" : "warn"}
        />
        <ProductMetric
          label="本地资料"
          value={unlocked ? "已解锁" : "已锁定"}
          detail="端侧保险箱"
          tone={unlocked ? "good" : "default"}
        />
        <ProductMetric
          label="待处理冲突"
          value={conflicts.length}
          detail="不会静默覆盖"
          tone={conflicts.length ? "bad" : "good"}
        />
        <ProductMetric
          label="同步队列"
          value={queueSummary.total}
          detail={`${queueSummary.pending} 待推送 · ${queueSummary.blocked + queueSummary.isolated} 需诊断`}
          tone={queueSummary.blocked || queueSummary.isolated ? "warn" : "info"}
        />
        <ProductMetric
          label="附件队列"
          value={attachments.length}
          detail="上传后校验哈希"
          tone={attachments.length ? "info" : "default"}
        />
      </div>
      <article className="settings-card sync-status-card">
        <div>
          <p className="eyebrow">Connection</p>
          <h2>{connection === "online" ? "已连接" : "离线工作中"}</h2>
        </div>
        <span
          className={`status-orb status-${connection}`}
          aria-hidden="true"
        />
        <ProductTag tone={connection === "online" ? "good" : "warn"}>
          {connection === "online" ? "网络可用" : "本地优先"}
        </ProductTag>
        <p aria-live="polite">{status}</p>
        {unlocked ? (
          <button type="button" onClick={() => void synchronize()}>
            立即同步
          </button>
        ) : null}
      </article>

      <article className="settings-card sync-wide-card sync-topology-card">
        <div className="sync-card-heading">
          <div>
            <p className="eyebrow">Sync topology</p>
            <h2>真实同步拓扑与设备</h2>
          </div>
          <ProductTag tone={connection === "online" ? "good" : "warn"}>
            {connection === "online" ? "服务器可连接" : "服务器不可连接"}
          </ProductTag>
        </div>
        <div className="sync-topology-live" aria-label="当前同步拓扑">
          <div>
            <strong>本地加密仓库</strong>
            <small>{unlocked ? "当前已解锁" : "当前已锁定"}</small>
          </div>
          <span aria-hidden="true">⇄</span>
          <div>
            <strong>Logion sync-v1</strong>
            <small>
              {syncState?.last_sync_at
                ? `上次同步 ${new Date(syncState.last_sync_at).toLocaleString()}`
                : "尚无成功同步记录"}
            </small>
          </div>
          <span aria-hidden="true">⇄</span>
          <div>
            <strong>{devices.length} 台已登记设备</strong>
            <small>
              {devices.filter((device) => device.revoked_at === null).length}{" "}
              台未撤销
            </small>
          </div>
        </div>
        {devices.length ? (
          <ul className="sync-device-list" aria-label="已登记设备">
            {devices.map((device) => (
              <li key={device.id}>
                <span>
                  <strong>{device.name}</strong>
                  <small>
                    {device.platform} · 最近活动{" "}
                    {new Date(device.last_seen_at).toLocaleString()}
                  </small>
                </span>
                <ProductTag
                  tone={
                    device.revoked_at
                      ? "bad"
                      : device.current
                        ? "good"
                        : "default"
                  }
                >
                  {device.revoked_at
                    ? "已撤销"
                    : device.current
                      ? "当前设备"
                      : "已授权"}
                </ProductTag>
              </li>
            ))}
          </ul>
        ) : (
          <ProductEmptyState
            title="没有可展示的设备"
            description="设备接口未返回登记记录，当前无法建立同步拓扑。"
          />
        )}
        <div className="sync-queue-diagnostics" aria-label="同步队列诊断">
          <span>待推送 {queueSummary.pending}</span>
          <span>传输中 {queueSummary.in_flight}</span>
          <span>冲突 {queueSummary.conflict}</span>
          <span>阻塞 {queueSummary.blocked}</span>
          <span>隔离 {queueSummary.isolated}</span>
        </div>
      </article>

      <article className="settings-card">
        <p className="eyebrow">Local vault</p>
        <h2>{unlocked ? "本地资料已解锁" : "本地资料已锁定"}</h2>
        <label>
          工作区
          <select
            value={workspaceId}
            disabled={unlocked}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        {unlocked ? (
          <button type="button" onClick={lock}>
            立即锁定
          </button>
        ) : (
          <form onSubmit={(event) => void unlock(event)}>
            <label>
              本地解锁口令
              <input
                name="passphrase"
                type="password"
                minLength={12}
                required
              />
            </label>
            <button type="submit" disabled={!workspaceId || !deviceId}>
              解锁
            </button>
          </form>
        )}
      </article>

      <article className="settings-card sync-wide-card">
        <div className="sync-card-heading">
          <div>
            <p className="eyebrow">Review queue</p>
            <h2>待处理冲突</h2>
          </div>
          <span className="count-badge">{conflicts.length}</span>
        </div>
        {!unlocked ? <p>解锁后才能查看加密的本地与服务器版本。</p> : null}
        {unlocked && conflicts.length === 0 ? (
          <ProductEmptyState
            icon="✓"
            title="没有待处理冲突"
            description="当前设备与服务器之间没有需要人工选择的版本。"
          />
        ) : null}
        {conflicts.map((view) => (
          <section key={view.conflict.conflict_id} className="settings-card">
            <h3>{view.conflict.entity_type} 冲突</h3>
            <p>
              当前设备修改：版本 {view.conflict.base_version}；服务器版本：
              {view.conflict.remote_version}；发现时间：
              {new Date(view.conflict.created_at).toLocaleString()}
            </p>
            {view.conflict.status === "resolving" ? (
              <p role="status">解决方案正在等待服务器确认。</p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>当前设备</th>
                      <th>服务器</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldDiff(view).map((item) => (
                      <tr key={item.field}>
                        <th>{item.field}</th>
                        <td>{item.local}</td>
                        <td>{item.remote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  {view.conflict.resolution_options.includes("keep_local") ? (
                    <button
                      type="button"
                      onClick={() => void resolve(view, "keep_local")}
                    >
                      保留当前设备版本
                    </button>
                  ) : null}
                  {view.conflict.resolution_options.includes("keep_remote") ? (
                    <button
                      type="button"
                      onClick={() => void resolve(view, "keep_remote")}
                    >
                      采用服务器版本
                    </button>
                  ) : null}
                  {view.conflict.resolution_options.includes("merge") ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMergeConflictId(view.conflict.conflict_id);
                        setMergeDraft(JSON.stringify(view.local, null, 2));
                      }}
                    >
                      编辑合并版本
                    </button>
                  ) : null}
                  {["note", "resource"].includes(view.conflict.entity_type) ? (
                    <button type="button" onClick={() => void copyLocal(view)}>
                      复制本地版本为新对象
                    </button>
                  ) : null}
                  {view.conflict.resolution_options.includes("dismiss") ? (
                    <button
                      type="button"
                      onClick={() => {
                        const db = database.current;
                        const localVault = vault.current;
                        if (db && localVault)
                          void new ConflictRepository(db, localVault)
                            .dismiss(workspaceId, view.conflict.conflict_id)
                            .then(() => refresh(db, localVault));
                      }}
                    >
                      暂不处理
                    </button>
                  ) : null}
                </div>
                {mergeConflictId === view.conflict.conflict_id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void resolve(view, "merge");
                    }}
                  >
                    <label>
                      合并后的 JSON 对象
                      <textarea
                        value={mergeDraft}
                        onChange={(event) => setMergeDraft(event.target.value)}
                        rows={12}
                      />
                    </label>
                    <button type="submit">提交合并版本</button>
                    <button
                      type="button"
                      onClick={() => setMergeConflictId(null)}
                    >
                      取消
                    </button>
                  </form>
                ) : null}
              </>
            )}
          </section>
        ))}
      </article>

      <article className="settings-card sync-wide-card">
        <div className="sync-card-heading">
          <div>
            <p className="eyebrow">Attachments</p>
            <h2>附件上传队列</h2>
          </div>
          <span className="count-badge">{attachments.length}</span>
        </div>
        {attachments.length === 0 ? (
          <ProductEmptyState
            icon="✓"
            title="附件队列为空"
            description="等待上传或重试的附件会出现在这里。"
          />
        ) : null}
        <ul>
          {attachments.map((attachment) => (
            <li key={attachment.attachment_id}>
              <strong>{attachment.filename}</strong> — {attachment.state} —{" "}
              {attachment.byte_size} bytes
              {attachment.state === "pending_upload" ||
              attachment.state === "failed" ? (
                <button type="button" onClick={() => void upload(attachment)}>
                  {attachment.state === "failed" ? "重试" : "上传并验证"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </article>

      <article className="settings-card sync-wide-card device-clear-card">
        <div>
          <p className="eyebrow">Device data</p>
          <h2>清除此设备数据</h2>
          <p>
            删除当前账户保存在此浏览器中的保险箱、离线副本、待同步操作、冲突、附件队列和同步游标。服务器数据不会删除，其他设备不受影响。
          </p>
        </div>
        <form className="device-clear-form" onSubmit={clearThisDevice}>
          <label>
            输入 <code>{CLEAR_DEVICE_CONFIRMATION}</code> 确认
            <input
              value={clearConfirmation}
              onChange={(event) => setClearConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            className="danger-button"
            type="submit"
            disabled={
              clearConfirmation !== CLEAR_DEVICE_CONFIRMATION ||
              vaultPhase === "clearing"
            }
          >
            {vaultPhase === "clearing" ? "正在清除…" : "清除此设备数据"}
          </button>
        </form>
      </article>

      <aside className="residual-data-warning sync-wide-card" role="note">
        <strong>共享设备提示：</strong>
        退出账号不会自动承诺清除浏览器中的全部离线副本。在公共设备上请使用“清除此设备数据”；设备被撤销后，本地库保持锁定，直到明确清除。
      </aside>
    </section>
  );
}
