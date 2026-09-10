import type {
  OutboxEntry,
  OutboxState,
  SyncCycleResult,
} from "@logion/offline";

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
