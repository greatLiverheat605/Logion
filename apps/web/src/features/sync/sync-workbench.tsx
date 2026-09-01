"use client";

import type { components } from "@logion/contracts";
import type {
  AttachmentQueueEntry,
  OutboxEntry,
  WorkspaceSyncState,
} from "@logion/offline";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
} from "@/components/product/headless-ui";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
} from "@/components/product/workbench";
import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";

import type { ConflictView } from "./offline-sync-center";
import type { SyncQueueSummary } from "./sync-diagnostics";
import styles from "./sync-workbench.module.css";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type PermissionIssue = "permission" | "error" | null;

export const CLEAR_DEVICE_CONFIRMATION = "CLEAR THIS DEVICE";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function fieldDiff(view: ConflictView) {
  return Array.from(
    new Set([...Object.keys(view.local), ...Object.keys(view.remote)]),
  )
    .slice(0, 50)
    .map((field) => ({
      field,
      local: JSON.stringify(view.local[field]) ?? "—",
      remote: JSON.stringify(view.remote[field]) ?? "—",
      changed:
        JSON.stringify(view.local[field]) !==
        JSON.stringify(view.remote[field]),
    }))
    .filter((item) => item.changed);
}

export interface SyncWorkbenchProps {
  accessIssue: PermissionIssue;
  attachments: AttachmentQueueEntry[];
  clearConfirmation: string;
  connection: "offline" | "online";
  conflicts: ConflictView[];
  deviceId: string;
  devices: Device[];
  lock: () => void;
  loading: boolean;
  mergeConflictId: string | null;
  mergeDraft: string;
  onClearConfirmationChange: (value: string) => void;
  onClearDevice: (event: FormEvent<HTMLFormElement>) => void;
  onCopyLocal: (view: ConflictView) => void;
  onDismiss: (view: ConflictView) => void;
  onMergeDraftChange: (value: string) => void;
  onMergeOpen: (view: ConflictView) => void;
  onMergeOpenChange: (open: boolean) => void;
  onReload: () => void;
  onResolve: (
    view: ConflictView,
    resolution: "keep_local" | "keep_remote" | "merge",
  ) => void;
  onSynchronize: () => void;
  onUnlock: (event: FormEvent<HTMLFormElement>) => void;
  onUpload: (attachment: AttachmentQueueEntry) => void;
  onWorkspaceChange: (workspaceId: string) => void;
  outbox: OutboxEntry[];
  queueSummary: SyncQueueSummary;
  status: string;
  syncState: WorkspaceSyncState | null;
  syncing: boolean;
  unlocked: boolean;
  vaultPhase: string;
  workspaceId: string;
  workspaces: Workspace[];
}

export function SyncWorkbench({
  accessIssue,
  attachments,
  clearConfirmation,
  connection,
  conflicts,
  deviceId,
  devices,
  lock,
  loading,
  mergeConflictId,
  mergeDraft,
  onClearConfirmationChange,
  onClearDevice,
  onCopyLocal,
  onDismiss,
  onMergeDraftChange,
  onMergeOpen,
  onMergeOpenChange,
  onReload,
  onResolve,
  onSynchronize,
  onUnlock,
  onUpload,
  onWorkspaceChange,
  outbox,
  queueSummary,
  status,
  syncState,
  syncing,
  unlocked,
  vaultPhase,
  workspaceId,
  workspaces,
}: SyncWorkbenchProps) {
  const initialTab = () => {
    if (typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (requested === "conflict" || requested === "conflicts") {
        return "conflicts";
      }
    }
    return conflicts.length > 0 ? "conflicts" : "outbox";
  };
  const [activeTab, setActiveTab] = useState(initialTab);
  const previousConflictCount = useRef(conflicts.length);
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
  const currentDevice = devices.find((item) => item.id === deviceId) ?? null;
  const lastSync = formatDate(syncState?.last_sync_at);
  const hasIsolation = Boolean(syncState?.outbox_isolated_at);
  const canSync =
    unlocked &&
    connection === "online" &&
    Boolean(workspaceId && deviceId) &&
    !syncing &&
    !hasIsolation;
  const primaryIsConflict = conflicts.length > 0;
  const primaryEnabled = primaryIsConflict ? unlocked : canSync;
  const primaryReason = primaryIsConflict
    ? unlocked
      ? ""
      : "先解锁本地 Vault 才能安全查看冲突"
    : !unlocked
      ? "先解锁本地 Vault"
      : connection === "offline"
        ? "离线时先查看 Outbox，恢复网络后再同步"
        : !workspaceId || !deviceId
          ? "需要有效 Workspace 和当前设备"
          : hasIsolation
            ? "Outbox 已隔离，请先完成 epoch 恢复"
            : syncing
              ? "同步进行中，请等待当前操作完成"
              : "";

  useEffect(() => {
    if (previousConflictCount.current === 0 && conflicts.length > 0) {
      setActiveTab("conflicts");
    }
    previousConflictCount.current = conflicts.length;
  }, [conflicts.length]);

  const selectTab = (value: string) => {
    setActiveTab(value);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", value === "conflicts" ? "conflict" : value);
      window.history.replaceState({}, "", url);
    }
  };

  const contextItems = [
    {
      key: "workspace",
      label: "Workspace",
      value: workspace?.name ?? "未选择",
    },
    {
      key: "network",
      label: "网络",
      tone: connection === "online" ? ("good" as const) : ("warn" as const),
      value: connection === "online" ? "在线" : "离线",
    },
    {
      key: "vault",
      label: "Vault",
      tone: unlocked ? ("good" as const) : ("warn" as const),
      value: unlocked ? "已解锁" : "已锁定",
    },
    {
      key: "conflicts",
      label: "冲突",
      tone: conflicts.length ? ("warn" as const) : ("default" as const),
      value: conflicts.length ? (
        <a className={styles.contextLink} href="/app/sync?tab=conflict">
          {conflicts.length} 项待处理
        </a>
      ) : (
        "无"
      ),
    },
    {
      key: "epoch",
      label: "Sync epoch",
      value: syncState?.sync_epoch ?? "尚未 bootstrap",
    },
  ];

  return (
    <>
      <main className={`${styles.page} app-shell-content`} id="main-content">
        <WorkbenchFrame
          context={
            <div data-testid="sync-summary">
              <WorkbenchContextBar items={contextItems} />
            </div>
          }
          header={
            <WorkbenchHeader
              description="把本地 Outbox、冲突、附件和设备状态放在一个可恢复的操作面里。"
              eyebrow="SYNC DIAGNOSTICS"
              title="同步诊断"
            />
          }
          inspector={
            <div data-testid="sync-inspector">
              <InspectorSection title="同步上下文">
                <dl className={styles.kvList}>
                  <div>
                    <dt>Workspace</dt>
                    <dd>{workspace?.name ?? "未选择"}</dd>
                  </div>
                  <div>
                    <dt>网络</dt>
                    <dd>{connection === "online" ? "在线" : "离线工作中"}</dd>
                  </div>
                  <div>
                    <dt>上次同步</dt>
                    <dd>{lastSync}</dd>
                  </div>
                  <div>
                    <dt>设备</dt>
                    <dd>{currentDevice?.name ?? "未登记"}</dd>
                  </div>
                </dl>
              </InspectorSection>
              <InspectorSection title="本地 Vault">
                <p aria-live="polite" className={styles.inspectorStatus}>
                  {unlocked
                    ? "本地加密资料已解锁，可读取冲突正文。"
                    : "解锁后才能查看本地与服务器版本。"}
                </p>
                {unlocked ? (
                  <button type="button" onClick={lock}>
                    <AppIcon name="lock" size={14} />
                    立即锁定
                  </button>
                ) : (
                  <form className={styles.unlockForm} onSubmit={onUnlock}>
                    <label htmlFor="sync-passphrase">本地解锁口令</label>
                    <input
                      disabled={vaultPhase === "unlocking"}
                      id="sync-passphrase"
                      minLength={12}
                      name="passphrase"
                      required
                      type="password"
                    />
                    <button
                      disabled={
                        !workspaceId || !deviceId || vaultPhase === "unlocking"
                      }
                      type="submit"
                    >
                      {vaultPhase === "unlocking" ? "正在解锁…" : "解锁资料"}
                    </button>
                  </form>
                )}
              </InspectorSection>
              <InspectorSection title="运行状态">
                <p className={styles.inspectorStatus}>{status}</p>
                <span className={styles.statusNote}>
                  {connection === "offline"
                    ? "在线后可推送 Outbox；本地读取不受阻断。"
                    : "服务端可连接，写入会保留 operation_id 与 payload_hash。"}
                </span>
              </InspectorSection>
            </div>
          }
          inspectorLabel="Sync 检查器"
          initialPane="main"
          label="同步诊断工作台"
          main={
            <div className={styles.mainPane} data-testid="sync-main">
              <WorkbenchActionBar
                primary={
                  <button
                    aria-describedby="sync-primary-help"
                    className={styles.primaryButton}
                    disabled={!primaryEnabled}
                    title={primaryReason}
                    type="button"
                    onClick={() => {
                      if (primaryIsConflict) selectTab("conflicts");
                      else onSynchronize();
                    }}
                  >
                    <AppIcon
                      name={primaryIsConflict ? "shield" : "refresh"}
                      size={15}
                    />
                    {primaryIsConflict
                      ? "处理冲突"
                      : syncing
                        ? "同步中…"
                        : "立即同步"}
                  </button>
                }
                secondary={
                  <span className={styles.actionHint} id="sync-primary-help">
                    {primaryReason ||
                      (conflicts.length
                        ? `${conflicts.length} 项冲突需要人工选择`
                        : `${queueSummary.total} 项队列记录`)}
                  </span>
                }
              />
              {accessIssue ? (
                <div
                  aria-live="polite"
                  className={styles.stateNotice}
                  data-testid="sync-access-state"
                  role="alert"
                >
                  <strong>
                    {accessIssue === "permission"
                      ? "没有同步权限"
                      : "同步上下文读取失败"}
                  </strong>
                  <span>
                    {accessIssue === "permission"
                      ? "当前角色不能读取此 Workspace 的设备或同步数据；请联系 Workspace Owner。"
                      : status}
                  </span>
                  <button type="button" onClick={onReload}>
                    重新读取
                  </button>
                </div>
              ) : null}
              {syncState?.bootstrap_state === "staging" ? (
                <div
                  className={styles.stateNotice}
                  data-testid="sync-bootstrap"
                  role="status"
                >
                  <strong>Bootstrap 分块拉取中</strong>
                  <span>快照正在逐块写入本地 Vault，完成前不会开始推送。</span>
                </div>
              ) : syncState?.bootstrap_state === "rebootstrap_required" ? (
                <div
                  className={styles.stateNotice}
                  data-testid="sync-bootstrap"
                  role="status"
                >
                  <strong>需要重新 Bootstrap</strong>
                  <span>
                    本地快照与服务器 schema
                    不一致；点击“立即同步”重新拉取分块快照。
                  </span>
                </div>
              ) : null}
              {hasIsolation ? (
                <div
                  className={styles.staleNotice}
                  data-testid="sync-isolation"
                  role="alert"
                >
                  <strong>Outbox 已隔离，当前数据只读</strong>
                  <span>
                    {syncState?.isolation_reason_code ?? "服务器 epoch 已变化"}{" "}
                    · 隔离于 {formatDate(syncState?.outbox_isolated_at)}。请重新
                    Bootstrap 后再推送，避免旧 epoch 写入。
                  </span>
                  <button type="button" onClick={onReload}>
                    检查恢复状态
                  </button>
                </div>
              ) : null}
              {!loading && !accessIssue && !deviceId ? (
                <div
                  className={styles.capabilityNotice}
                  data-testid="sync-capability-disabled"
                  role="note"
                >
                  <strong>当前浏览器没有登记设备</strong>
                  <span>
                    设备同步能力已停用；请在安全设置登记本机设备后再使用同步。
                  </span>
                </div>
              ) : null}
              <WorkbenchTabs
                label="同步诊断视图"
                onValueChange={selectTab}
                tabs={[
                  { label: "Outbox", value: "outbox", count: outbox.length },
                  {
                    label: "冲突",
                    value: "conflicts",
                    count: conflicts.length,
                  },
                  {
                    label: "附件队列",
                    value: "attachments",
                    count: attachments.length,
                  },
                  { label: "设备", value: "devices", count: devices.length },
                ]}
                value={activeTab}
              >
                <WorkbenchTabPanel value="outbox">
                  <section
                    className={styles.tabSection}
                    data-testid="sync-outbox"
                  >
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>OUTBOX</span>
                        <h2>待推送操作</h2>
                      </div>
                      <ProductTag tone={queueSummary.pending ? "warn" : "good"}>
                        {queueSummary.pending
                          ? `${queueSummary.pending} 待推送`
                          : "已清空"}
                      </ProductTag>
                    </header>
                    <div
                      aria-label="Outbox 状态摘要"
                      className={styles.queueSummary}
                    >
                      <span>pending {queueSummary.pending}</span>
                      <span>in-flight {queueSummary.in_flight}</span>
                      <span>conflict {queueSummary.conflict}</span>
                      <span>blocked {queueSummary.blocked}</span>
                      <span>isolated {queueSummary.isolated}</span>
                    </div>
                    {loading ? (
                      <div className={styles.loadingState} role="status">
                        <strong>正在读取 Outbox…</strong>
                        <span>
                          本地队列和同步 epoch 读取完成后会显示在这里。
                        </span>
                      </div>
                    ) : outbox.length ? (
                      <div className={styles.tableWrap}>
                        <table>
                          <caption>sync-v1 Outbox 明细</caption>
                          <thead>
                            <tr>
                              <th>状态</th>
                              <th>操作</th>
                              <th>operation_id</th>
                              <th>payload_hash</th>
                              <th>重试次数</th>
                            </tr>
                          </thead>
                          <tbody>
                            {outbox.map((item) => (
                              <tr key={item.operation_id}>
                                <td>{item.outbox_state}</td>
                                <td>{item.operation_type}</td>
                                <td>
                                  <code>{item.operation_id}</code>
                                </td>
                                <td>
                                  <code>{item.payload_hash}</code>
                                </td>
                                <td>
                                  <span>{item.attempt_count}</span>
                                  {item.last_error_code ? (
                                    <small className={styles.rowError}>
                                      {item.last_error_code}
                                    </small>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <ProductEmptyState
                        title="Outbox 为空"
                        description="本地写入会先进入这里；离线时不会伪装成已同步。"
                      />
                    )}
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="conflicts">
                  <section
                    className={styles.tabSection}
                    data-testid="sync-conflicts"
                  >
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>CONFLICT REVIEW</span>
                        <h2>显式解决冲突</h2>
                      </div>
                      <ProductTag tone={conflicts.length ? "warn" : "good"}>
                        {conflicts.length
                          ? `${conflicts.length} 项待处理`
                          : "无冲突"}
                      </ProductTag>
                    </header>
                    {!unlocked ? (
                      <p className={styles.lockedNote}>
                        解锁本地 Vault 后，才能安全读取冲突对比。
                      </p>
                    ) : conflicts.length === 0 ? (
                      <ProductEmptyState
                        title="没有待处理冲突"
                        description="当前设备与服务器之间没有需要人工选择的版本。"
                      />
                    ) : (
                      conflicts.map((view) => (
                        <article
                          className={styles.conflict}
                          key={view.conflict.conflict_id}
                        >
                          <header>
                            <div>
                              <strong>
                                {view.conflict.entity_type} ·{" "}
                                {view.conflict.conflict_id.slice(0, 8)}
                              </strong>
                              <span>
                                本地基线 v{view.conflict.base_version} · 服务器
                                v{view.conflict.remote_version}
                              </span>
                            </div>
                            <ProductTag tone="warn">409</ProductTag>
                          </header>
                          <div className={styles.compare}>
                            <div>
                              <span>当前设备</span>
                              <pre>{JSON.stringify(view.local, null, 2)}</pre>
                            </div>
                            <div>
                              <span>服务器</span>
                              <pre>{JSON.stringify(view.remote, null, 2)}</pre>
                            </div>
                          </div>
                          <div
                            aria-label="冲突字段差异"
                            className={styles.diffTable}
                          >
                            {fieldDiff(view).map((item) => (
                              <div key={item.field}>
                                <strong>{item.field}</strong>
                                <span>{item.local}</span>
                                <span>{item.remote}</span>
                              </div>
                            ))}
                          </div>
                          <div className={styles.conflictActions}>
                            {view.conflict.resolution_options.includes(
                              "keep_local",
                            ) ? (
                              <button
                                type="button"
                                onClick={() => onResolve(view, "keep_local")}
                              >
                                保留当前设备版本
                              </button>
                            ) : null}
                            {view.conflict.resolution_options.includes(
                              "keep_remote",
                            ) ? (
                              <button
                                type="button"
                                onClick={() => onResolve(view, "keep_remote")}
                              >
                                采用服务器版本
                              </button>
                            ) : null}
                            {view.conflict.resolution_options.includes(
                              "merge",
                            ) ? (
                              <button
                                type="button"
                                onClick={() => onMergeOpen(view)}
                              >
                                编辑合并版本
                              </button>
                            ) : null}
                            {view.conflict.resolution_options.includes(
                              "dismiss",
                            ) ? (
                              <button
                                type="button"
                                onClick={() => onDismiss(view)}
                              >
                                暂不处理
                              </button>
                            ) : null}
                            {["note", "resource"].includes(
                              view.conflict.entity_type,
                            ) ? (
                              <button
                                type="button"
                                onClick={() => onCopyLocal(view)}
                              >
                                复制本地版本为新对象
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))
                    )}
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="attachments">
                  <section
                    className={styles.tabSection}
                    data-testid="sync-attachments"
                  >
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>ATTACHMENTS</span>
                        <h2>附件上传队列</h2>
                      </div>
                      <ProductTag tone={attachments.length ? "info" : "good"}>
                        {attachments.length} 项
                      </ProductTag>
                    </header>
                    <div
                      className={styles.quotaNote}
                      data-testid="attachments-quota"
                      role="note"
                    >
                      <strong>附件配额</strong>
                      <span>
                        上传初始化由服务器校验用户配额；本地队列不会伪造剩余额度。
                      </span>
                    </div>
                    {attachments.length ? (
                      <ul className={styles.attachmentList}>
                        {attachments.map((attachment) => (
                          <li key={attachment.attachment_id}>
                            <div>
                              <strong>{attachment.filename}</strong>
                              <span>
                                {attachment.state} · {attachment.byte_size}{" "}
                                bytes
                              </span>
                              {attachment.last_error_code ? (
                                <small className={styles.rowError}>
                                  失败原因：{attachment.last_error_code}
                                </small>
                              ) : null}
                            </div>
                            {attachment.state === "pending_upload" ||
                            attachment.state === "failed" ? (
                              <button
                                type="button"
                                onClick={() => onUpload(attachment)}
                              >
                                {attachment.state === "failed"
                                  ? "重试"
                                  : "上传并验证"}
                              </button>
                            ) : (
                              <ProductTag tone="good">已验证</ProductTag>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <ProductEmptyState
                        title="附件队列为空"
                        description="等待上传或重试的附件会出现在这里。"
                      />
                    )}
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="devices">
                  <section
                    className={styles.tabSection}
                    data-testid="sync-devices"
                  >
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>DEVICES</span>
                        <h2>设备与本地数据</h2>
                      </div>
                      <ProductTag tone={devices.length ? "good" : "warn"}>
                        {devices.length} 台登记设备
                      </ProductTag>
                    </header>
                    <div className={styles.topology}>
                      <div>
                        <strong>本地仓库</strong>
                        <span>{unlocked ? "已解锁" : "已锁定"}</span>
                      </div>
                      <span aria-hidden="true">⇄</span>
                      <div>
                        <strong>sync-v1</strong>
                        <span>{lastSync}</span>
                      </div>
                      <span aria-hidden="true">⇄</span>
                      <div>
                        <strong>当前设备</strong>
                        <span>{currentDevice?.name ?? "未登记"}</span>
                      </div>
                    </div>
                    <div
                      className={styles.capabilityNotice}
                      data-testid="device-trust-status"
                      role="note"
                    >
                      <strong>信任等级</strong>
                      <span>
                        当前 Device API 暴露当前设备、授权与撤销状态；细粒度
                        trust level 由安全中心管理。
                      </span>
                    </div>
                    {devices.length ? (
                      <ul className={styles.deviceList}>
                        {devices.map((device) => (
                          <li key={device.id}>
                            <div>
                              <strong>{device.name}</strong>
                              <span>
                                {device.platform} ·{" "}
                                {device.current
                                  ? "当前设备 · 已授权"
                                  : "已授权设备"}{" "}
                                · 最近活动 {formatDate(device.last_seen_at)}
                              </span>
                            </div>
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
                  </section>
                </WorkbenchTabPanel>
              </WorkbenchTabs>
              <div className={styles.deviceClear}>
                <header>
                  <div>
                    <span className={styles.kicker}>LOCAL DATA</span>
                    <h3>清除此设备数据</h3>
                  </div>
                </header>
                <p>
                  只删除本浏览器中的
                  Vault、离线副本、Outbox、冲突和附件队列；服务器数据不会删除，其他设备不受影响。此操作不可恢复，恢复路径是重新从服务器
                  Bootstrap。
                </p>
                <form onSubmit={onClearDevice}>
                  <label htmlFor="clear-device-confirm">
                    输入 <code>{CLEAR_DEVICE_CONFIRMATION}</code> 确认
                  </label>
                  <input
                    autoComplete="off"
                    id="clear-device-confirm"
                    onChange={(event) =>
                      onClearConfirmationChange(event.target.value)
                    }
                    spellCheck={false}
                    value={clearConfirmation}
                  />
                  <button
                    className={styles.dangerButton}
                    disabled={
                      clearConfirmation !== CLEAR_DEVICE_CONFIRMATION ||
                      vaultPhase === "clearing"
                    }
                    type="submit"
                  >
                    {vaultPhase === "clearing" ? "正在清除…" : "清除此设备数据"}
                  </button>
                </form>
              </div>
            </div>
          }
          master={
            <div className={styles.masterPane} data-testid="sync-master">
              <div className={styles.masterHeading}>
                <div>
                  <span className={styles.kicker}>SYNC CONTROL</span>
                  <h2>同步工作区</h2>
                </div>
                <ProductTag tone={connection === "online" ? "good" : "warn"}>
                  {connection === "online" ? "ONLINE" : "OFFLINE"}
                </ProductTag>
              </div>
              <label htmlFor="sync-master-workspace">当前 Workspace</label>
              <select
                className={styles.select}
                disabled={unlocked}
                id="sync-master-workspace"
                onChange={(event) => onWorkspaceChange(event.target.value)}
                value={workspaceId}
              >
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {loading ? (
                <div className={styles.loadingState} role="status">
                  <strong>正在读取上下文…</strong>
                  <span>Workspace 与设备状态读取完成后可继续。</span>
                </div>
              ) : null}
              <nav aria-label="同步工作区分区" className={styles.masterNav}>
                {[
                  { label: "Outbox", value: "outbox", count: outbox.length },
                  {
                    label: "冲突",
                    value: "conflicts",
                    count: conflicts.length,
                  },
                  {
                    label: "附件队列",
                    value: "attachments",
                    count: attachments.length,
                  },
                  { label: "设备", value: "devices", count: devices.length },
                ].map((item) => (
                  <button
                    aria-current={activeTab === item.value ? "page" : undefined}
                    className={
                      activeTab === item.value ? styles.selectedRow : undefined
                    }
                    key={item.value}
                    onClick={() => selectTab(item.value)}
                    type="button"
                  >
                    <span>{item.label}</span>
                    <span>{item.count}</span>
                  </button>
                ))}
              </nav>
              <div className={styles.masterFooter}>
                <span>epoch</span>
                <code>{syncState?.sync_epoch ?? "—"}</code>
              </div>
            </div>
          }
          masterLabel="Sync 控制目录"
          mainLabel="同步诊断"
          toolbar={
            <div className={styles.toolbarNote}>
              <AppIcon
                name={connection === "online" ? "refresh" : "lock"}
                size={14}
              />
              <span>
                {connection === "online"
                  ? "在线依赖动作可用；所有写入仍保留幂等证据。"
                  : "离线·本地更改进入 Outbox，恢复网络后再推送。"}
              </span>
            </div>
          }
        />
      </main>
      <WorkbenchSheet
        description="只提交显式选择的合并 JSON；不会静默覆盖本地或服务器版本。"
        onOpenChange={onMergeOpenChange}
        open={mergeConflictId !== null}
        title="编辑合并版本"
      >
        <form
          className={styles.mergeForm}
          onSubmit={(event) => {
            event.preventDefault();
            const view = conflicts.find(
              (item) => item.conflict.conflict_id === mergeConflictId,
            );
            if (view) onResolve(view, "merge");
          }}
        >
          <label htmlFor="merge-payload">合并后的 JSON 对象</label>
          <textarea
            id="merge-payload"
            onChange={(event) => onMergeDraftChange(event.target.value)}
            rows={16}
            value={mergeDraft}
          />
          <footer>
            <button type="button" onClick={() => onMergeOpenChange(false)}>
              取消
            </button>
            <button className={styles.primaryButton} type="submit">
              提交合并版本
            </button>
          </footer>
        </form>
      </WorkbenchSheet>
    </>
  );
}
