import { describe, expect, it } from "vitest";

import {
  buildPlanningPhaseSequence,
  derivePlanningViewModel,
  type PlanningGoalRecord,
  type PlanningTaskRecord,
} from "./planning-workbench-model";

function goal(
  id: string,
  updatedAt: string,
  spaceId = "space-1",
): PlanningGoalRecord {
  return {
    id,
    payload: {
      description: "",
      desired_outcome: `${id} outcome`,
      phases: [
        {
          acceptance_criteria: ["提交成果"],
          description: "",
          estimated_minutes: 60,
          id: `${id}-phase-2`,
          position: 1,
          title: "输出",
        },
        {
          acceptance_criteria: ["通过检查"],
          description: "",
          estimated_minutes: 30,
          id: `${id}-phase-1`,
          position: 0,
          title: "基础",
        },
      ],
      space_id: spaceId,
      target_date: "2026-11-30",
      title: id,
      weekly_minutes: 420,
    },
    syncStatus: "clean",
    updatedAt,
  };
}

function task(
  id: string,
  goalId: string,
  phaseId: string | null,
): PlanningTaskRecord {
  return {
    id,
    payload: {
      estimated_minutes: 45,
      goal_id: goalId,
      phase_id: phaseId,
      space_id: "space-1",
      status: "planned",
      title: id,
    },
    syncStatus: "clean",
    updatedAt: "2026-08-26T12:00:00.000Z",
  };
}

describe("planning workbench model", () => {
  it("uses position only as an ordered predecessor hint", () => {
    const phases = buildPlanningPhaseSequence([
      {
        acceptance_criteria: ["提交成果"],
        description: "",
        estimated_minutes: 60,
        id: "b",
        position: 2,
        title: "产出",
      },
      {
        acceptance_criteria: ["通过检查"],
        description: "",
        estimated_minutes: 30,
        id: "a",
        position: 0,
        title: "基础",
      },
    ]);

    expect(phases.map((phase) => phase.title)).toEqual(["基础", "产出"]);
    expect(phases[0]?.priorPhaseTitle).toBeNull();
    expect(phases[1]?.priorPhaseTitle).toBe("基础");
  });

  it("selects a real goal and groups only its tasks into the ordered route", () => {
    const older = goal("goal-old", "2026-08-25T12:00:00.000Z");
    const selected = goal("goal-selected", "2026-08-26T12:00:00.000Z");
    const view = derivePlanningViewModel({
      goals: [
        older,
        selected,
        goal("other-space", "2026-08-27T12:00:00.000Z", "space-2"),
      ],
      selectedGoalId: selected.id,
      spaceId: "space-1",
      tasks: [
        task("phase task", selected.id, "goal-selected-phase-1"),
        task("unassigned task", selected.id, null),
        task("other goal task", older.id, "goal-old-phase-1"),
      ],
    });

    expect(view.visibleGoals.map((item) => item.id)).toEqual([
      "goal-selected",
      "goal-old",
    ]);
    expect(view.selectedGoal?.id).toBe("goal-selected");
    expect(view.phaseSequence.map((phase) => phase.title)).toEqual([
      "基础",
      "输出",
    ]);
    expect(
      view.tasksByPhase["goal-selected-phase-1"]?.map((item) => item.id),
    ).toEqual(["phase task"]);
    expect(view.unassignedTasks.map((item) => item.id)).toEqual([
      "unassigned task",
    ]);
    expect(view.tasks.map((item) => item.id)).not.toContain("other goal task");
    expect(view.plannedMinutes).toBe(90);
    expect(view.readiness).toBe(100);
  });

  it("falls back to the newest visible goal and reports incomplete acceptance", () => {
    const incomplete = goal("newest", "2026-08-26T12:00:00.000Z");
    incomplete.payload = {
      ...incomplete.payload,
      phases: incomplete.payload.phases.map((phase, index) => ({
        ...phase,
        acceptance_criteria: index === 0 ? [""] : phase.acceptance_criteria,
      })),
    };
    const view = derivePlanningViewModel({
      goals: [goal("older", "2026-08-25T12:00:00.000Z"), incomplete],
      selectedGoalId: "missing",
      spaceId: "space-1",
      tasks: [],
    });

    expect(view.selectedGoal?.id).toBe("newest");
    expect(view.missingAcceptanceCriteria).toBe(1);
    expect(view.readiness).toBe(80);
  });
});
