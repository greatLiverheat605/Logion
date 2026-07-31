import { describe, expect, it } from "vitest";

import { summarizeSyncQueue } from "./sync-diagnostics";

describe("sync diagnostics", () => {
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
