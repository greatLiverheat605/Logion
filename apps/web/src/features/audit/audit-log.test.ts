import type { components } from "@logion/contracts";
import { describe, expect, it } from "vitest";

import { filterAuditEvents } from "./audit-log";

type AuditEvent = components["schemas"]["AuditEventResponse"];

const events: AuditEvent[] = [
  {
    actor_id: null,
    event_type: "auth.login",
    id: "01900000-0000-7000-8000-000000000001",
    occurred_at: "2026-07-27T08:00:00Z",
    result: "success",
    target_id: null,
    target_type: "session",
  },
  {
    actor_id: null,
    event_type: "workspace.invitation.rejected",
    id: "01900000-0000-7000-8000-000000000002",
    occurred_at: "2026-07-27T09:00:00Z",
    result: "denied",
    target_id: null,
    target_type: "workspace_invitation",
  },
  {
    actor_id: null,
    event_type: "workspace.opened",
    id: "01900000-0000-7000-8000-000000000003",
    occurred_at: "2026-07-27T10:00:00Z",
    result: "success",
    target_id: null,
    target_type: "workspace",
  },
];

describe("audit event filters", () => {
  it("searches only the displayed event summary fields", () => {
    expect(filterAuditEvents(events, "INVITATION", "all", "all")).toEqual([
      events[1],
    ]);
    expect(filterAuditEvents(events, "denied", "all", "all")).toEqual([
      events[1],
    ]);
    expect(
      filterAuditEvents(events, "workspace_invitation", "all", "all"),
    ).toEqual([events[1]]);
  });

  it("separates successful and other results", () => {
    expect(filterAuditEvents(events, "", "success", "all")).toEqual([
      events[0],
      events[2],
    ]);
    expect(filterAuditEvents(events, "", "other", "all")).toEqual([events[1]]);
  });

  it("combines target type and keyword filters without changing order", () => {
    expect(filterAuditEvents(events, "opened", "success", "workspace")).toEqual(
      [events[2]],
    );
    expect(filterAuditEvents(events, "login", "all", "workspace")).toEqual([]);
  });

  it("can locate an event by its traceable target id", () => {
    const targetId = "01900000-0000-7000-8000-000000000099";
    expect(
      filterAuditEvents(
        [{ ...events[0]!, target_id: targetId }],
        targetId,
        "all",
        "all",
      ),
    ).toHaveLength(1);
  });
});
