import { describe, expect, it } from "vitest";

import {
  buildPersonaDashboard,
  type PersonaDashboardRecord,
  type PersonaDashboardSource,
} from "./persona-dashboard-model";

const NOW = new Date("2026-07-31T08:00:00.000Z");

function record(
  entityType: string,
  spaceId: string,
  payload: Record<string, unknown> = {},
  id = `${entityType}-1`,
): PersonaDashboardRecord {
  return {
    createdAt: "2026-07-30T08:00:00.000Z",
    entityType,
    id,
    payload,
    spaceId,
    syncStatus: "clean",
    updatedAt: "2026-07-30T08:00:00.000Z",
  };
}

function source(
  overrides: Partial<PersonaDashboardSource> = {},
): PersonaDashboardSource {
  return {
    members: [],
    membersAvailable: true,
    now: NOW,
    records: [],
    selectedSpaceId: "private-a",
    sessions: [],
    spaces: [
      { id: "private-a", visibility: "private" },
      { id: "shared-a", visibility: "shared" },
    ],
    tasks: [],
    ...overrides,
  };
}

describe("persona dashboard model", () => {
  it("builds each built-in dashboard from its real entity families", () => {
    const records = [
      record("exam", "private-a", {
        exam_at: "2026-08-10T08:00:00.000Z",
        status: "active",
        title: "真实考试",
      }),
      record("learning_track", "private-a", { title: "真实路线" }),
      record("research_question", "private-a", { question: "真实问题" }),
      record("rubric", "shared-a", { title: "真实标准" }),
    ];

    expect(buildPersonaDashboard("exam", source({ records })).eyebrow).toBe(
      "EXAM COMMAND",
    );
    expect(buildPersonaDashboard("self", source({ records })).eyebrow).toBe(
      "LEARNING PROJECTS",
    );
    expect(buildPersonaDashboard("research", source({ records })).eyebrow).toBe(
      "RESEARCH MISSION CONTROL",
    );
    expect(buildPersonaDashboard("mentor", source({ records })).eyebrow).toBe(
      "MENTOR & GROUP COMMAND",
    );
  });

  it("does not emit a misleading percentage for a zero score denominator", () => {
    const model = buildPersonaDashboard(
      "exam",
      source({
        records: [
          record("score_record", "private-a", {
            completed_at: "2026-07-30T08:00:00.000Z",
            score: 0,
            score_scale_max: 0,
          }),
        ],
      }),
    );

    expect(
      model.metrics.find((metric) => metric.label === "最近成绩")?.value,
    ).toBe("暂无记录");
    expect(JSON.stringify(model)).not.toContain("NaN");
    expect(JSON.stringify(model)).not.toContain("Infinity");
  });

  it("excludes every private Space from mentor aggregates", () => {
    const model = buildPersonaDashboard(
      "mentor",
      source({
        members: [
          { id: "member-1", status: "active" },
          { id: "member-2", status: "active" },
        ],
        records: [
          record("group_review", "private-a", {}, "private-review"),
          record("review_finding", "private-a", { status: "open" }),
          record("group_review", "shared-a", {}, "shared-review"),
        ],
      }),
    );

    expect(
      model.metrics.find((metric) => metric.label === "共享 Space")?.value,
    ).toBe(1);
    expect(model.metrics.find((metric) => metric.label === "待审")?.value).toBe(
      1,
    );
    expect(
      model.metrics.find((metric) => metric.label === "审查发现")?.value,
    ).toBe(0);
  });

  it("does not treat the mentor persona as permission to list members", () => {
    const model = buildPersonaDashboard(
      "mentor",
      source({ membersAvailable: false }),
    );

    expect(model.metrics.find((metric) => metric.label === "成员")?.value).toBe(
      "需管理权限",
    );
    expect(model.primaryAction.label).not.toBe("邀请成员");
  });

  it("uses completed sessions from the latest seven days for self-study focus", () => {
    const model = buildPersonaDashboard(
      "self",
      source({
        sessions: [
          {
            manualMinutes: 45,
            spaceId: "private-a",
            startedAt: "2026-07-30T08:00:00.000Z",
            status: "completed",
          },
          {
            manualMinutes: 90,
            spaceId: "private-a",
            startedAt: "2026-07-01T08:00:00.000Z",
            status: "completed",
          },
        ],
      }),
    );

    expect(
      model.metrics.find((metric) => metric.label === "本周专注")?.value,
    ).toBe("45m");
  });
});
