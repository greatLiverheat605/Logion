import type { OutboxEntry, OutboxState } from "@logion/offline";

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
