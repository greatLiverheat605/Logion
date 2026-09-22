import type {
  OutboxEntry,
  OutboxState,
  SyncCycleResult,
  LogionOfflineDatabase,
  WorkspaceSyncState,
  OfflineVault,
} from "@logion/offline";

export function matchesVaultSession(
  database: { current: LogionOfflineDatabase | null },
  vault: { current: OfflineVault | null },
  db: LogionOfflineDatabase | null,
  localVault: OfflineVault | null,
): boolean {
  return (
    db !== null &&
    localVault !== null &&
    database.current === db &&
    vault.current === localVault
  );
}

export interface WorkspaceSyncFacts {
  workspaceId: string;
  state: WorkspaceSyncState | null;
  queue: SyncQueueSummary;
  conflicts: number;
  attachments: number;
}

export async function readWorkspaceSyncFacts(
  db: LogionOfflineDatabase,
  workspaceId: string,
): Promise<WorkspaceSyncFacts> {
  const [state, outbox, conflicts, attachments] = await Promise.all([
    db.syncState.get(workspaceId),
    db.outbox.where("workspace_id").equals(workspaceId).toArray(),
    db.conflicts
      .where("[workspace_id+status]")
      .equals([workspaceId, "open"])
      .count(),
    db.attachmentQueue.where("workspace_id").equals(workspaceId).toArray(),
  ]);
  return {
    workspaceId,
    state: state ?? null,
    queue: summarizeSyncQueue(outbox),
    conflicts,
    attachments: attachments.filter((entry) => entry.state !== "verified")
      .length,
  };
}

export function workspaceSyncStatus({
  facts,
  workspaceId,
  deviceId,
  unlocked,
  online,
  busy = false,
  loading = false,
  error = false,
}: {
  facts: WorkspaceSyncFacts | null;
  workspaceId: string;
  deviceId: string;
  unlocked: boolean;
  online: boolean;
  busy?: boolean;
  loading?: boolean;
  error?: boolean;
}): { label: string; tone: "default" | "good" | "warn" } {
  const pending = (label: string) => ({ label, tone: "warn" as const });
  if (!unlocked) return pending("解锁后确认");
  if (!workspaceId || !deviceId) return pending("等待同步上下文");
  if (error) return pending("同步状态待确认");
  if (loading || !facts || facts.workspaceId !== workspaceId)
    return { label: "读取中", tone: "default" };
  const state = facts.state;
  if (state?.outbox_isolated_at || facts.queue.isolated)
    return pending("同步已隔离");
  if (state?.bootstrap_state === "upgrade_required")
    return pending("需要更新应用");
  if (
    !state ||
    state.workspace_id !== workspaceId ||
    state.device_id !== deviceId ||
    state.bootstrap_state !== "ready" ||
    !state.sync_epoch
  )
    return pending("等待同步初始化");
  if (facts.conflicts || facts.queue.conflict) return pending("有同步冲突");
  if (facts.queue.blocked) return pending("同步受阻");
  if (!online) return pending("离线·本地保留");
  if (busy || facts.queue.in_flight)
    return { label: "同步中", tone: "default" };
  if (facts.queue.total || facts.attachments) return pending("待同步");
  return { label: "已同步", tone: "good" };
}

export function incompleteSyncMessage(
  result: SyncCycleResult,
  entries: readonly Pick<OutboxEntry, "outbox_state" | "last_error_code">[],
): string | null {
  if (result.control === "upgrade_required") {
    return "同步已暂停，请更新应用后重试；未上传的本地内容已保留，无需清除本地数据（upgrade_required）。";
  }
  if (result.control) {
    return `同步未完成；本地数据保留，请重新同步或更新客户端（${result.control}）。`;
  }
  if (entries.length) {
    const code = entries.find(
      (entry) => entry.last_error_code,
    )?.last_error_code;
    return `仍有 ${entries.length} 项本地修改未同步，请在同步中心检查冲突或重试（${code ?? "SYNC_OUTBOX_PENDING"}）。`;
  }
  return result.has_more
    ? "同步未完成，仍有数据待拉取，请继续同步（SYNC_PULL_PENDING）。"
    : null;
}

export type SyncQueueSummary = Readonly<Record<OutboxState, number>> &
  Readonly<{ total: number }>;

export function summarizeSyncQueue(
  entries: readonly Pick<OutboxEntry, "outbox_state">[],
): SyncQueueSummary {
  const summary: Record<OutboxState, number> = {
    blocked: 0,
    conflict: 0,
    in_flight: 0,
    isolated: 0,
    pending: 0,
  };
  for (const entry of entries) summary[entry.outbox_state] += 1;
  return { ...summary, total: entries.length };
}
