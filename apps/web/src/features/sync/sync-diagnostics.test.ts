import { describe, expect, it } from "vitest";

import {
  incompleteSyncMessage,
  summarizeSyncQueue,
  workspaceSyncStatus,
  type WorkspaceSyncFacts,
} from "./sync-diagnostics";

describe("sync diagnostics", () => {
  it("only reports synchronized for a known matching ready workspace with empty queues", () => {
    const facts: WorkspaceSyncFacts = {
      workspaceId: "a",
      state: {
        workspace_id: "a",
        device_id: "d",
        schema_version: 3,
        sync_epoch: "epoch",
        cursor: 0,
        bootstrap_state: "ready",
        last_sync_at: null,
        outbox_isolated_at: null,
        isolation_reason_code: null,
      },
      queue: summarizeSyncQueue([]),
      conflicts: 0,
      attachments: 0,
    };
    const input = {
      facts,
      workspaceId: "a",
      deviceId: "d",
      unlocked: true,
      online: true,
    };
    expect(workspaceSyncStatus(input).label).toBe("已同步");
    for (const override of [
      { unlocked: false },
      { loading: true },
      { error: true },
      { facts: null },
      { workspaceId: "b" },
      { deviceId: "other" },
      { online: false },
      { busy: true },
    ]) {
      expect(workspaceSyncStatus({ ...input, ...override }).label).not.toBe(
        "已同步",
      );
    }
    for (const bootstrap_state of [
      "empty",
      "staging",
      "upgrade_required",
      "rebootstrap_required",
    ] as const) {
      expect(
        workspaceSyncStatus({
          ...input,
          facts: { ...facts, state: { ...facts.state!, bootstrap_state } },
        }).label,
      ).not.toBe("已同步");
    }
    for (const outbox_state of [
      "pending",
      "blocked",
      "isolated",
      "conflict",
      "in_flight",
    ] as const) {
      expect(
        workspaceSyncStatus({
          ...input,
          facts: { ...facts, queue: summarizeSyncQueue([{ outbox_state }]) },
        }).label,
      ).not.toBe("已同步");
    }
    expect(
      workspaceSyncStatus({ ...input, facts: { ...facts, attachments: 1 } })
        .label,
    ).toBe("待同步");
    expect(
      workspaceSyncStatus({ ...input, facts: { ...facts, conflicts: 1 } })
        .label,
    ).toBe("有同步冲突");
  });
  it("does not treat returned sync controls, pending pulls or blocked Outbox entries as success", () => {
    const result = { pushed: 0, pulled: 0, has_more: false, control: null };
    expect(incompleteSyncMessage(result, [])).toBeNull();
    expect(
      incompleteSyncMessage({ ...result, control: "upgrade_required" }, []),
    ).toContain("upgrade_required");
    expect(incompleteSyncMessage({ ...result, has_more: true }, [])).toContain(
      "SYNC_PULL_PENDING",
    );
    expect(
      incompleteSyncMessage(result, [
        { outbox_state: "blocked", last_error_code: "SYNC_PERMISSION_DENIED" },
      ]),
    ).toContain("SYNC_PERMISSION_DENIED");
  });
  it("reports real outbox states without treating conflicts as pending", () => {
    expect(
      summarizeSyncQueue([
        { outbox_state: "pending" },
        { outbox_state: "pending" },
        { outbox_state: "conflict" },
        { outbox_state: "isolated" },
      ]),
    ).toEqual({
      blocked: 0,
      conflict: 1,
      in_flight: 0,
      isolated: 1,
      pending: 2,
      total: 4,
    });
  });
});
