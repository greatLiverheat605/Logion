import { describe, expect, it } from "vitest";

import { incompleteSyncMessage, summarizeSyncQueue } from "./sync-diagnostics";

describe("sync diagnostics", () => {
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
