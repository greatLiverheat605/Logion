import type { LocalEntity } from "@logion/offline";

export function mutationTimestamp(
  existing: Pick<LocalEntity, "created_at" | "updated_at"> | undefined,
  now: string,
): string {
  // 墙钟回拨时保留实体时间下界，client_occurred_at 仍记录实际发生时间。
  return [existing?.created_at, existing?.updated_at].reduce<string>(
    (latest, timestamp) =>
      timestamp && Date.parse(timestamp) >= Date.parse(latest)
        ? timestamp
        : latest,
    now,
  );
}
