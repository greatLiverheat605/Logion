import type { LocalEntity } from "@logion/offline";
import { describe, expect, it } from "vitest";

import {
  deriveTodayOperationalKind,
  deriveTodayViewModel,
  TODAY_COMMAND_KEYS,
  type TodayLocalView,
  type TodayTaskPayload,
} from "./use-today-controller";

function task(
  id: string,
  status: TodayTaskPayload["status"],
  priority: number,
  spaceId = "space-1",
): TodayLocalView<TodayTaskPayload> {
  return {
    entity: {
      created_at: `2026-08-2${priority}T00:00:00.000Z`,
      entity_id: id,
    } as LocalEntity,
    payload: {
      blocked_reason: null,
      description: "",
      due_at: null,
      estimated_minutes: 50,
      goal_id: "goal-1",
      phase_id: null,
      planned_at: null,
      priority,
      space_id: spaceId,
      status,
      title: id,
    },
  };
}

describe("Today controller contract", () => {
  it("keeps every formal mutation and context command reachable", () => {
    expect(TODAY_COMMAND_KEYS).toEqual([
      "closeVerifiedTask",
      "createTask",
      "decideVerification",
      "finishSession",
      "loadContext",
      "setSelectedTaskId",
      "setSpaceId",
      "setWorkspaceId",
      "startSession",
      "submitEvidence",
      "synchronize",
      "transitionTask",
      "unlock",
    ]);
  });

  it("sorts the queue by workflow status then higher priority", () => {
    const plannedLow = task("planned-low", "planned", 1);
    const backlog = task("backlog", "backlog", 4);
    const active = task("active", "in_progress", 2);
    const plannedHigh = task("planned-high", "planned", 4);
    const otherSpace = task("other", "in_progress", 4, "space-2");

    const model = deriveTodayViewModel({
      evidence: [],
      goals: [],
      selectedTaskId: "",
      sessions: [],
      spaceId: "space-1",
      tasks: [plannedLow, backlog, otherSpace, active, plannedHigh],
      verifications: [],
    });

    expect(model.queue.map((item) => item.entity.entity_id)).toEqual([
      "active",
      "planned-high",
      "planned-low",
      "backlog",
    ]);
    expect(model.nextTask?.entity.entity_id).toBe("active");
    expect(model.selectedTask?.entity.entity_id).toBe("active");
  });

  it("keeps an explicit selection while deriving real totals", () => {
    const done = task("done", "done", 2);
    const selected = task("selected", "planned", 3);
    const model = deriveTodayViewModel({
      evidence: [],
      goals: [],
      selectedTaskId: "done",
      sessions: [
        {
          entity: {} as LocalEntity,
          payload: {
            ended_at: "2026-08-26T00:30:00.000Z",
            manual_minutes: 30,
            outcome: "completed",
            reflection: "",
            space_id: "space-1",
            started_at: "2026-08-26T00:00:00.000Z",
            status: "completed",
            task_id: "done",
          },
        },
      ],
      spaceId: "space-1",
      tasks: [selected, done],
      verifications: [],
    });

    expect(model.selectedTask?.entity.entity_id).toBe("done");
    expect(model.completedTaskCount).toBe(1);
    expect(model.completedMinutes).toBe(30);
    expect(model.completionRate).toBe(50);
  });

  it("prioritizes recovery states without disguising errors as empty data", () => {
    const base = {
      conflictCount: 0,
      contextPhase: "ready" as const,
      dashboardPhase: "ready" as const,
      deviceAvailable: true,
      hasContext: true,
      hasData: true,
      online: true,
      stale: false,
      unlocked: true,
    };

    expect(deriveTodayOperationalKind({ ...base, contextPhase: "error" })).toBe(
      "error",
    );
    expect(deriveTodayOperationalKind({ ...base, unlocked: false })).toBe(
      "locked",
    );
    expect(deriveTodayOperationalKind({ ...base, conflictCount: 1 })).toBe(
      "conflict",
    );
    expect(deriveTodayOperationalKind({ ...base, online: false })).toBe(
      "offline",
    );
    expect(deriveTodayOperationalKind({ ...base, hasData: false })).toBe(
      "empty",
    );
    expect(deriveTodayOperationalKind(base)).toBeNull();
  });
});
