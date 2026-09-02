import { describe, expect, it } from "vitest";

import {
  buildResearchEvidenceProjection,
  buildMetricComparison,
  finiteMetricValue,
  researchClaimStatus,
  researchQuestionCoverage,
  submittedMetricValue,
} from "./research-workbench-model";

describe("research workbench model", () => {
  it("accepts only finite numeric metric payloads", () => {
    expect(finiteMetricValue(0)).toBe(0);
    expect(finiteMetricValue(null)).toBeNull();
    expect(finiteMetricValue("")).toBeNull();
    expect(finiteMetricValue(false)).toBeNull();
    expect(finiteMetricValue(Number.NaN)).toBeNull();
    expect(finiteMetricValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteMetricValue(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("accepts only non-empty finite metric form values", () => {
    expect(submittedMetricValue("0")).toBe(0);
    expect(submittedMetricValue(" 1.5 ")).toBe(1.5);
    expect(submittedMetricValue(null)).toBeNull();
    expect(submittedMetricValue("")).toBeNull();
    expect(submittedMetricValue("   ")).toBeNull();
    expect(submittedMetricValue(false)).toBeNull();
    expect(submittedMetricValue("NaN")).toBeNull();
    expect(submittedMetricValue("Infinity")).toBeNull();
    expect(submittedMetricValue("-Infinity")).toBeNull();
    expect(submittedMetricValue("-2")).toBe(-2);
  });

  it("labels only the claim states available in the existing contract", () => {
    expect(researchClaimStatus("supports")).toMatchObject({
      relation: "来源支持该声明",
      status: expect.stringContaining("待验证"),
    });
    expect(researchClaimStatus("opposes")).toMatchObject({
      relation: "来源反对该声明",
      status: expect.stringContaining("正式或拒绝状态"),
    });
    expect(researchClaimStatus("mixed")).toMatchObject({
      relation: "证据存在分歧",
      status: expect.stringContaining("争议"),
    });
    expect(researchClaimStatus("unknown")).toMatchObject({
      relation: "候选声明",
      status: expect.stringContaining("候选"),
    });
  });

  it("projects only relationships whose parent exists in the current chain", () => {
    expect(
      buildResearchEvidenceProjection({
        paperIds: ["paper-1"],
        claimLinks: [
          { id: "claim-1", parentId: "paper-1" },
          { id: "claim-orphan", parentId: "missing-paper" },
        ],
        questionIds: ["question-1"],
        runLinks: [
          { id: "run-1", parentId: "question-1" },
          { id: "run-orphan", parentId: "missing-question" },
        ],
        metricLinks: [
          { id: "metric-1", parentId: "run-1" },
          { id: "metric-orphan", parentId: "run-orphan" },
        ],
        feedbackLinks: [
          { id: "feedback-1", parentId: "claim-1" },
          { id: "feedback-orphan", parentId: "claim-orphan" },
        ],
      }),
    ).toEqual({
      claimIds: ["claim-1"],
      feedbackIds: ["feedback-1"],
      metricIds: ["metric-1"],
      runIds: ["run-1"],
    });
  });

  it("does not project linked records when their root collection is empty", () => {
    expect(
      buildResearchEvidenceProjection({
        paperIds: [],
        claimLinks: [{ id: "claim-1", parentId: "paper-1" }],
        questionIds: [],
        runLinks: [{ id: "run-1", parentId: "question-1" }],
        metricLinks: [{ id: "metric-1", parentId: "run-1" }],
        feedbackLinks: [{ id: "feedback-1", parentId: "claim-1" }],
      }),
    ).toEqual({ claimIds: [], feedbackIds: [], metricIds: [], runIds: [] });
  });

  it.each([null, "", " ", false, 0, {}, []])(
    "fails closed for malformed %p parent IDs in every evidence relationship",
    (parentId) => {
      expect(
        buildResearchEvidenceProjection({
          paperIds: ["false"],
          claimLinks: [{ id: "claim-1", parentId }],
          questionIds: ["0"],
          runLinks: [{ id: "run-1", parentId }],
          metricLinks: [{ id: "metric-1", parentId }],
          feedbackLinks: [{ id: "feedback-1", parentId }],
        }),
      ).toEqual({ claimIds: [], feedbackIds: [], metricIds: [], runIds: [] });
    },
  );

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
