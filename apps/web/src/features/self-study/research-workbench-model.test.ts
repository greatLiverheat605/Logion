import { describe, expect, it } from "vitest";

import {
  buildMetricComparison,
  researchQuestionCoverage,
} from "./research-workbench-model";

describe("research workbench model", () => {
  it("counts questions with at least one linked run", () => {
    expect(
      researchQuestionCoverage(
        ["q1", "q2"],
        [
          { id: "r1", parentId: "q1" },
          { id: "r2", parentId: "q1" },
          { id: "orphan", parentId: "missing" },
        ],
      ),
    ).toBe(50);
    expect(researchQuestionCoverage([], [])).toBeNull();
  });

  it("compares only linked finite metrics with the same name and unit", () => {
    expect(
      buildMetricComparison(
        [
          { id: "r1", title: "运行一" },
          { id: "r2", title: "运行二" },
        ],
        [
          { id: "m1", name: "accuracy", runId: "r1", unit: "%", value: 80 },
          { id: "m2", name: "accuracy", runId: "r2", unit: "%", value: 82 },
          {
            id: "m3",
            name: "accuracy",
            runId: "r2",
            unit: "ratio",
            value: 0.82,
          },
        ],
      ),
    ).toEqual([
      {
        name: "accuracy",
        unit: "%",
        values: [
          { runTitle: "运行一", value: 80 },
          { runTitle: "运行二", value: 82 },
        ],
      },
    ]);
  });
});
