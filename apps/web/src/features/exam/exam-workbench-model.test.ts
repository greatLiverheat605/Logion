import { describe, expect, it } from "vitest";

import { examCoverageRate, normalizeExamScores } from "./exam-workbench-model";

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
});
