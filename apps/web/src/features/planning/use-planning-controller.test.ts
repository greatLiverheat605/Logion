import { describe, expect, it } from "vitest";

import {
  buildPlanningGoalPayload,
  derivePlanningOperationalKind,
  PLANNING_COMMAND_KEYS,
  shouldApplyPlanningResponse,
} from "./use-planning-controller";

const ready = {
  commandPhase: "idle" as const,
  conflictCount: 0,
  contextPhase: "ready" as const,
  dataPhase: "ready" as const,
  deviceAvailable: true,
  hasContext: true,
  hasData: true,
  online: true,
  stale: false,
  unlocked: true,
};

describe("Planning controller contract", () => {
  it("keeps every formal Planning command reachable", () => {
    expect(PLANNING_COMMAND_KEYS).toEqual([
      "createGoal",
      "loadContext",
      "selectGoal",
      "setSpaceId",
      "setWorkspaceId",
      "synchronize",
      "unlock",
    ]);
  });

  it("preserves the protected learning-goal aggregate payload", () => {
    expect(
      buildPlanningGoalPayload(
        {
          criterion: "提交一份可检查成果",
          description: "背景",
          desiredOutcome: "完成成果",
          phaseMinutes: 600,
          phaseTitle: "首个阶段",
          targetDate: "",
          title: "系统学习",
          weeklyMinutes: 360,
        },
        {
          goalId: "goal-1",
          phaseId: "phase-1",
          planId: "plan-1",
          planVersionId: "version-1",
        },
        "space-1",
      ),
    ).toEqual({
      description: "背景",
      desired_outcome: "完成成果",
      phases: [
        {
          acceptance_criteria: ["提交一份可检查成果"],
          description: "",
          estimated_minutes: 600,
          id: "phase-1",
          position: 0,
          title: "首个阶段",
        },
      ],
      plan_id: "plan-1",
      plan_version_id: "version-1",
      space_id: "space-1",
      target_date: null,
      title: "系统学习",
      weekly_minutes: 360,
    });
  });

  it("does not apply stale Workspace responses", () => {
    expect(
      shouldApplyPlanningResponse(3, 3, "workspace-1", "workspace-1"),
    ).toBe(true);
    expect(
      shouldApplyPlanningResponse(2, 3, "workspace-1", "workspace-1"),
    ).toBe(false);
    expect(
      shouldApplyPlanningResponse(3, 3, "workspace-1", "workspace-2"),
    ).toBe(false);
  });

  it("maps the formal recovery states without displaying guessed data", () => {
    expect(
      derivePlanningOperationalKind({ ...ready, contextPhase: "loading" }),
    ).toBe("loading");
    expect(derivePlanningOperationalKind({ ...ready, unlocked: false })).toBe(
      "locked",
    );
    expect(derivePlanningOperationalKind({ ...ready, online: false })).toBe(
      "offline",
    );
    expect(derivePlanningOperationalKind({ ...ready, conflictCount: 1 })).toBe(
      "conflict",
    );
    expect(derivePlanningOperationalKind({ ...ready, stale: true })).toBe(
      "stale",
    );
    expect(
      derivePlanningOperationalKind({
        ...ready,
        deviceAvailable: false,
      }),
    ).toBe("capability-disabled");
    expect(derivePlanningOperationalKind(ready)).toBeNull();
  });
});
