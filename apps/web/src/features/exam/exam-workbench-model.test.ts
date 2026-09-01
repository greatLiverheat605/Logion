import { describe, expect, it } from "vitest";

import {
  EXAM_ENTITY_TYPES,
  EXAM_WORKBENCH_REGIONS,
  buildExamPayload,
  examCountdown,
  examCoverageRate,
  normalizeExamScores,
  validateExamScorePair,
} from "./exam-workbench-model";

describe("exam workbench model", () => {
  it("does not create a zero percentage when the syllabus is empty", () => {
    expect(examCoverageRate([])).toBeNull();
  });

  it("sorts valid scores by completion time and ignores invalid scales", () => {
    expect(
      normalizeExamScores([
        {
          completed_at: "2026-07-02T00:00:00Z",
          score: 80,
          score_scale_max: 100,
        },
        {
          completed_at: "2026-07-01T00:00:00Z",
          score: 30,
          score_scale_max: 50,
        },
        { completed_at: "2026-07-03T00:00:00Z", score: 0, score_scale_max: 0 },
      ]),
    ).toEqual([60, 80]);
  });

  it("freezes the formal entity and region boundary for the Exam workbench", () => {
    expect(EXAM_ENTITY_TYPES).toEqual([
      "exam",
      "exam_subject",
      "syllabus_node",
      "mock_exam",
      "score_record",
    ]);
    expect(EXAM_WORKBENCH_REGIONS).toEqual([
      "exam-list",
      "exam-coverage",
      "exam-syllabus",
      "exam-mocks",
      "exam-weaknesses",
    ]);
  });

  it("keeps exam date projection client-side and validates score pairs", () => {
    const payload = buildExamPayload({
      dateStatus: "scheduled",
      examAt: "2026-11-07T09:00",
      scoreScaleMax: "100",
      targetScore: "80",
      title: "系统架构设计师",
      timezone: "Asia/Shanghai",
    });
    expect(payload.title).toBe("系统架构设计师");
    expect(payload.target_score).toBe(80);
    expect(payload.score_scale_max).toBe(100);
    expect(payload.status).toBe("planning");
    expect(payload.timezone).toBe("Asia/Shanghai");
    expect(payload.exam_at).toMatch(/^2026-11-07T01:00:00\.000Z$/);
    expect(validateExamScorePair("80", "")).toBe(
      "目标分与满分必须成对填写。",
    );
    expect(validateExamScorePair("120", "100")).toBe("目标分不能高于满分。");
    expect(validateExamScorePair("80", "100")).toBeNull();
    expect(examCountdown("2026-11-08T00:00:00.000Z", Date.parse("2026-11-07T00:00:00.000Z"))).toBe("剩余 1 天");
  });
});
