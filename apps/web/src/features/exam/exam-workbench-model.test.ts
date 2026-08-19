import { describe, expect, it } from "vitest";

import {
  buildExamCoverageProjection,
  buildReviewGapProjection,
  buildScoreTrend,
  type ExamWorkbenchRecord,
  examCoverageRate,
  examScheduleDescriptor,
  normalizeExamScores,
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
});

function view(entityId: unknown, payload: unknown): ExamWorkbenchRecord {
  return { entity: { entity_id: entityId }, payload };
}

function examRecord(
  entityId: string,
  extra: Record<string, unknown> = {},
): ExamWorkbenchRecord {
  return view(entityId, {
    space_id: "space-1",
    title: "期末考试",
    date_status: "scheduled",
    exam_at: "2026-10-01T09:00:00Z",
    timezone: null,
    target_score: 80,
    score_scale_max: 100,
    status: "active",
    ...extra,
  });
}

function subjectRecord(entityId: string, examId: unknown): ExamWorkbenchRecord {
  return view(entityId, {
    space_id: "space-1",
    exam_id: examId,
    name: "数学",
    weight_basis_points: 6000,
    status: "active",
  });
}

function nodeRecord(
  entityId: string,
  subjectId: unknown,
  extra: Record<string, unknown> = {},
): ExamWorkbenchRecord {
  return view(entityId, {
    space_id: "space-1",
    subject_id: subjectId,
    parent_id: null,
    title: "章节",
    importance: 3,
    coverage_status: "not_started",
    ...extra,
  });
}

function mockRecord(entityId: string, examId: unknown): ExamWorkbenchRecord {
  return view(entityId, {
    space_id: "space-1",
    exam_id: examId,
    title: "第一次模考",
    duration_limit_seconds: 7200,
  });
}

function scoreRecord(
  entityId: string,
  mockExamId: unknown,
  extra: Record<string, unknown> = {},
): ExamWorkbenchRecord {
  return view(entityId, {
    space_id: "space-1",
    mock_exam_id: mockExamId,
    score: 85,
    score_scale_max: 100,
    duration_seconds: 5400,
    completed_at: "2026-08-01T10:00:00Z",
    ...extra,
  });
}

function scheduleRecord(entityId: string): ExamWorkbenchRecord {
  return view(entityId, {
    space_id: "space-1",
    topic_id: "topic-1",
    status: "scheduled",
    source: "manual",
    interval_days: 7,
    next_review_at: "2026-08-20T00:00:00Z",
    last_reviewed_at: null,
  });
}

const FIXED_NOW = new Date("2026-08-18T12:00:00Z").getTime();

const FULL_CHAIN = {
  exams: [examRecord("exam-1")],
  subjects: [subjectRecord("subject-1", "exam-1")],
  syllabusNodes: [
    nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
    nodeRecord("node-2", "subject-1", { coverage_status: "in_progress" }),
  ],
  mockExams: [mockRecord("mock-1", "exam-1")],
  scoreRecords: [scoreRecord("score-1", "mock-1")],
  reviewSchedules: [scheduleRecord("schedule-1")],
};

describe("examScheduleDescriptor", () => {
  it("describes a future exam with a real countdown", () => {
    const descriptor = examScheduleDescriptor(
      "2026-08-25T12:00:00Z",
      FIXED_NOW,
    );
    expect(descriptor).toEqual({
      status: "upcoming",
      label: "剩余 7 天",
      examAt: "2026-08-25T12:00:00Z",
      timestamp: new Date("2026-08-25T12:00:00Z").getTime(),
      daysRemaining: 7,
    });
  });

  it("marks a past exam without inventing a negative countdown", () => {
    const descriptor = examScheduleDescriptor(
      "2026-08-01T00:00:00Z",
      FIXED_NOW,
    );
    expect(descriptor.status).toBe("past");
    expect(descriptor).not.toHaveProperty("daysRemaining");
  });

  it("returns 待定 for missing, blank, malformed, or unparseable dates", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "not-a-date",
      "2026-13-45T99:99:99Z",
      42,
      true,
      {},
    ]) {
      expect(examScheduleDescriptor(bad, FIXED_NOW)).toEqual({
        status: "undetermined",
        label: "考试日期待定",
      });
    }
  });

  it("returns 待定 when the injected reference clock is invalid", () => {
    expect(examScheduleDescriptor("2026-08-25T12:00:00Z", Number.NaN)).toEqual({
      status: "undetermined",
      label: "考试日期待定",
    });
    expect(
      examScheduleDescriptor("2026-08-25T12:00:00Z", Number.POSITIVE_INFINITY),
    ).toEqual({ status: "undetermined", label: "考试日期待定" });
    expect(
      examScheduleDescriptor("2026-08-25T12:00:00Z", Number.NEGATIVE_INFINITY),
    ).toEqual({ status: "undetermined", label: "考试日期待定" });
    expect(
      examScheduleDescriptor("2026-08-25T12:00:00Z", new Date("invalid")),
    ).toEqual({ status: "undetermined", label: "考试日期待定" });
  });

  it("exposes only projection fields", () => {
    const descriptor = examScheduleDescriptor(
      "2026-08-25T12:00:00Z",
      FIXED_NOW,
    );
    expect(Object.keys(descriptor).sort()).toEqual([
      "daysRemaining",
      "examAt",
      "label",
      "status",
      "timestamp",
    ]);
  });
});

describe("buildExamCoverageProjection", () => {
  it("projects coverage over a real exam → subject → syllabus chain", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: FULL_CHAIN.exams,
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: FULL_CHAIN.syllabusNodes,
    });
    expect(projection).toEqual({
      examId: "exam-1",
      subjectCount: 1,
      nodeCount: 2,
      coveredCount: 1,
      coverageRate: 50,
    });
  });

  it("returns a null rate for an empty syllabus instead of 0%", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: FULL_CHAIN.exams,
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: [],
    });
    expect(projection).not.toBeNull();
    expect(projection?.coverageRate).toBeNull();
    expect(projection?.nodeCount).toBe(0);
  });

  it("returns null when the exam cannot be resolved", () => {
    const base = {
      exams: FULL_CHAIN.exams,
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: FULL_CHAIN.syllabusNodes,
    };
    expect(
      buildExamCoverageProjection({ ...base, examId: "missing-exam" }),
    ).toBeNull();
    for (const malformed of [null, "", "   ", true, 42, {}]) {
      expect(
        buildExamCoverageProjection({ ...base, examId: malformed }),
      ).toBeNull();
    }
  });

  it("excludes orphan subjects and their syllabus nodes", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [
        subjectRecord("subject-1", "exam-1"),
        subjectRecord("orphan-subject", "missing-exam"),
      ],
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
        nodeRecord("orphan-node", "orphan-subject", {
          coverage_status: "covered",
        }),
      ],
    });
    expect(projection).toEqual({
      examId: "exam-1",
      subjectCount: 1,
      nodeCount: 1,
      coveredCount: 1,
      coverageRate: 100,
    });
  });

  it("drops nodes with dangling or malformed parent references", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
        nodeRecord("node-2", "subject-1", {
          parent_id: "ghost-parent",
          coverage_status: "covered",
        }),
        nodeRecord("node-3", "subject-1", {
          parent_id: "",
          coverage_status: "covered",
        }),
        nodeRecord("node-4", "subject-1", {
          parent_id: "   ",
          coverage_status: "covered",
        }),
        nodeRecord("node-5", "subject-1", {
          parent_id: true,
          coverage_status: "covered",
        }),
        nodeRecord("node-6", "subject-1", {
          parent_id: 42,
          coverage_status: "covered",
        }),
        nodeRecord("node-7", "subject-1", {
          parent_id: { id: "node-1" },
          coverage_status: "covered",
        }),
      ],
    });
    expect(projection).toEqual({
      examId: "exam-1",
      subjectCount: 1,
      nodeCount: 1,
      coveredCount: 1,
      coverageRate: 100,
    });
  });

  it("cascades exclusion when a parent is dropped for its own malformed link", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
        nodeRecord("node-2", "subject-1", {
          parent_id: "node-3",
          coverage_status: "covered",
        }),
        nodeRecord("node-3", "orphan-subject", {
          coverage_status: "covered",
        }),
      ],
    });
    // node-3 is dropped (its subject does not belong to the exam), so
    // node-2's parent no longer resolves and node-2 is dropped as well.
    expect(projection?.nodeCount).toBe(1);
    expect(projection?.coverageRate).toBe(100);
  });

  it("keeps a child whose parent exists inside the same subject", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
        nodeRecord("node-2", "subject-1", {
          parent_id: "node-1",
          coverage_status: "not_started",
        }),
      ],
    });
    expect(projection?.nodeCount).toBe(2);
    expect(projection?.coverageRate).toBe(50);
  });

  it("drops cyclic and duplicate node IDs instead of counting ambiguous records", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("root", "subject-1", { coverage_status: "covered" }),
        nodeRecord("cycle-a", "subject-1", {
          parent_id: "cycle-b",
          coverage_status: "covered",
        }),
        nodeRecord("cycle-b", "subject-1", {
          parent_id: "cycle-a",
          coverage_status: "covered",
        }),
        nodeRecord("self-cycle", "subject-1", {
          parent_id: "self-cycle",
          coverage_status: "covered",
        }),
        nodeRecord("cycle-child", "subject-1", {
          parent_id: "cycle-a",
          coverage_status: "covered",
        }),
        nodeRecord("duplicate", "subject-1", {
          coverage_status: "covered",
        }),
        nodeRecord("duplicate", "subject-1", {
          coverage_status: "not_started",
        }),
      ],
    });
    expect(projection).toEqual({
      examId: "exam-1",
      subjectCount: 1,
      nodeCount: 1,
      coveredCount: 1,
      coverageRate: 100,
    });
  });

  it("drops every duplicate ID when one duplicate is malformed", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("root", "subject-1", { coverage_status: "covered" }),
        nodeRecord("duplicate", "subject-1", {
          coverage_status: "not_started",
        }),
        nodeRecord("duplicate", "missing-subject", {
          coverage_status: "covered",
        }),
      ],
    });
    expect(projection).toEqual({
      examId: "exam-1",
      subjectCount: 1,
      nodeCount: 1,
      coveredCount: 1,
      coverageRate: 100,
    });
  });

  it("drops subjects with malformed exam references", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [
        subjectRecord("subject-1", "exam-1"),
        subjectRecord("subject-null", null),
        subjectRecord("subject-empty", ""),
        subjectRecord("subject-blank", "   "),
        subjectRecord("subject-bool", true),
        subjectRecord("subject-number", 42),
        subjectRecord("subject-object", { id: "exam-1" }),
      ],
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
        nodeRecord("node-bad", "subject-null", { coverage_status: "covered" }),
      ],
    });
    expect(projection?.subjectCount).toBe(1);
    expect(projection?.nodeCount).toBe(1);
  });

  it("drops nodes with malformed coverage status or subject references", () => {
    const projection = buildExamCoverageProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
        nodeRecord("node-2", "subject-1", { coverage_status: "deleted" }),
        nodeRecord("node-3", "subject-1", { coverage_status: 3 }),
        nodeRecord("node-4", null, { coverage_status: "covered" }),
        nodeRecord("node-5", 42, { coverage_status: "covered" }),
        nodeRecord("node-6", true, { coverage_status: "covered" }),
      ],
    });
    expect(projection?.nodeCount).toBe(1);
    expect(projection?.coverageRate).toBe(100);
  });
});

describe("buildScoreTrend", () => {
  it("builds a chronological trend from real linked scores", () => {
    const trend = buildScoreTrend({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords: [
        scoreRecord("score-2", "mock-1", {
          score: 90,
          completed_at: "2026-08-03T10:00:00Z",
        }),
        scoreRecord("score-1", "mock-1", {
          score: 60,
          score_scale_max: 80,
          completed_at: "2026-08-02T10:00:00Z",
        }),
      ],
    });
    expect(trend.status).toBe("ok");
    if (trend.status !== "ok") return;
    expect(trend.points.map((point) => point.scoreId)).toEqual([
      "score-1",
      "score-2",
    ]);
    expect(trend.points.map((point) => point.normalizedPercent)).toEqual([
      75, 90,
    ]);
  });

  it("returns unknown when the exam cannot be resolved", () => {
    expect(
      buildScoreTrend({
        examId: "missing-exam",
        exams: [examRecord("exam-1")],
        mockExams: [mockRecord("mock-1", "exam-1")],
        scoreRecords: [scoreRecord("score-1", "mock-1")],
      }),
    ).toEqual({ status: "unknown" });
  });

  it("returns unknown when no admissible sample exists", () => {
    expect(
      buildScoreTrend({
        examId: "exam-1",
        exams: [examRecord("exam-1")],
        mockExams: [mockRecord("mock-1", "exam-1")],
        scoreRecords: [],
      }),
    ).toEqual({ status: "unknown" });
  });

  it("excludes scores without a real mock exam source", () => {
    const trend = buildScoreTrend({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords: [
        scoreRecord("score-1", "mock-1"),
        scoreRecord("orphan-score", "missing-mock"),
        scoreRecord("null-source", null),
        scoreRecord("empty-source", ""),
      ],
    });
    expect(trend.status).toBe("ok");
    if (trend.status !== "ok") return;
    expect(trend.points.map((point) => point.scoreId)).toEqual(["score-1"]);
  });

  it("excludes scores with missing or unparseable completion times", () => {
    const trend = buildScoreTrend({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords: [
        scoreRecord("score-1", "mock-1"),
        scoreRecord("no-time", "mock-1", { completed_at: null }),
        scoreRecord("bad-time", "mock-1", { completed_at: "yesterday" }),
        scoreRecord("blank-time", "mock-1", { completed_at: "   " }),
      ],
    });
    expect(trend.status).toBe("ok");
    if (trend.status !== "ok") return;
    expect(trend.points.map((point) => point.scoreId)).toEqual(["score-1"]);
  });

  it("excludes NaN, Infinity, negative, and non-numeric scores or scales", () => {
    const trend = buildScoreTrend({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords: [
        scoreRecord("score-1", "mock-1"),
        scoreRecord("nan", "mock-1", { score: Number.NaN }),
        scoreRecord("inf", "mock-1", { score: Number.POSITIVE_INFINITY }),
        scoreRecord("neg-inf", "mock-1", { score: Number.NEGATIVE_INFINITY }),
        scoreRecord("string-score", "mock-1", { score: "85" }),
        scoreRecord("bool-score", "mock-1", { score: true }),
        scoreRecord("negative", "mock-1", { score: -5 }),
        scoreRecord("over-scale", "mock-1", { score: 101 }),
        scoreRecord("nan-scale", "mock-1", { score_scale_max: Number.NaN }),
        scoreRecord("zero-scale", "mock-1", { score_scale_max: 0 }),
        scoreRecord("neg-scale", "mock-1", { score_scale_max: -100 }),
      ],
    });
    expect(trend.status).toBe("ok");
    if (trend.status !== "ok") return;
    expect(trend.points.map((point) => point.scoreId)).toEqual(["score-1"]);
    expect(trend.points[0]?.normalizedPercent).toBe(85);
  });

  it("keeps the snapshot stable when input arrays mutate afterwards", () => {
    const scoreRecords = [
      scoreRecord("score-1", "mock-1", {
        completed_at: "2026-08-02T10:00:00Z",
      }),
    ];
    const trend = buildScoreTrend({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords,
    });
    const snapshot = JSON.parse(JSON.stringify(trend));
    scoreRecords.push(
      scoreRecord("score-2", "mock-1", {
        completed_at: "2026-08-03T10:00:00Z",
      }),
    );
    scoreRecords.reverse();
    expect(trend).toEqual(snapshot);
  });

  it("exposes only projection fields on trend points", () => {
    const trend = buildScoreTrend({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords: [scoreRecord("score-1", "mock-1")],
    });
    expect(trend.status).toBe("ok");
    if (trend.status !== "ok") return;
    expect(Object.keys(trend.points[0]!).sort()).toEqual([
      "completedAt",
      "normalizedPercent",
      "score",
      "scoreId",
      "scoreScaleMax",
      "timestamp",
    ]);
  });
});

describe("buildReviewGapProjection", () => {
  it("identifies gaps from real syllabus coverage and real scores", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1", { target_score: 90 })],
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: FULL_CHAIN.syllabusNodes,
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: [
        scoreRecord("score-1", "mock-1", { score: 85 }),
        scoreRecord("score-2", "mock-1", {
          score: 95,
          completed_at: "2026-08-02T10:00:00Z",
        }),
      ],
      reviewSchedules: FULL_CHAIN.reviewSchedules,
    });
    expect(projection.status).toBe("ok");
    expect(projection.examId).toBe("exam-1");
    expect(projection.syllabusGaps).toEqual([
      { kind: "uncovered_syllabus_node", nodeId: "node-2" },
    ]);
    expect(projection.scoreGaps).toEqual([
      { kind: "score_below_target", scoreId: "score-1", normalizedPercent: 85 },
    ]);
  });

  it("treats a score at or above target as not a gap", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1", { target_score: 80 })],
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: [],
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: [scoreRecord("score-1", "mock-1", { score: 80 })],
      reviewSchedules: [],
    });
    expect(projection.scoreGaps).toEqual([]);
  });

  it("returns an explicit unknown projection without a resolvable exam", () => {
    const projection = buildReviewGapProjection({
      examId: null,
      exams: FULL_CHAIN.exams,
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: FULL_CHAIN.syllabusNodes,
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: FULL_CHAIN.scoreRecords,
      reviewSchedules: FULL_CHAIN.reviewSchedules,
    });
    expect(projection).toEqual({
      status: "unknown",
      examId: null,
      syllabusGaps: [],
      scoreGaps: [],
      reviewScheduleRelation: "unknown",
    });
  });

  it("returns an empty gap list when no target score exists instead of fabricating one", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1", { target_score: null })],
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: [
        nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
      ],
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: [scoreRecord("score-1", "mock-1", { score: 10 })],
      reviewSchedules: [],
    });
    expect(projection.status).toBe("ok");
    expect(projection.syllabusGaps).toEqual([]);
    expect(projection.scoreGaps).toEqual([]);
  });

  it("does not treat a target above the score scale as a valid gap threshold", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1", { target_score: 120 })],
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: [],
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: [scoreRecord("score-1", "mock-1", { score: 80 })],
      reviewSchedules: [],
    });
    expect(projection.scoreGaps).toEqual([]);
  });

  it("excludes an over-scale score from review gaps", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1", { target_score: 90 })],
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: [],
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: [scoreRecord("over-scale", "mock-1", { score: 150 })],
      reviewSchedules: [],
    });
    expect(projection.scoreGaps).toEqual([]);
  });

  it("excludes ambiguous duplicate syllabus IDs from review gaps", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes: [
        nodeRecord("duplicate", "subject-1", {
          coverage_status: "not_started",
        }),
        nodeRecord("duplicate", "missing-subject", {
          coverage_status: "covered",
        }),
      ],
      mockExams: [],
      scoreRecords: [],
      reviewSchedules: [],
    });
    expect(projection.syllabusGaps).toEqual([]);
  });

  it("never links review schedules to exam objects: the relation stays unknown", () => {
    const base = {
      examId: "exam-1",
      exams: FULL_CHAIN.exams,
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: FULL_CHAIN.syllabusNodes,
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: FULL_CHAIN.scoreRecords,
    };
    const linked = buildReviewGapProjection({
      ...base,
      reviewSchedules: [scheduleRecord("schedule-1")],
    });
    const orphan = buildReviewGapProjection({
      ...base,
      reviewSchedules: [scheduleRecord("schedule-orphan")],
    });
    const malformed = buildReviewGapProjection({
      ...base,
      reviewSchedules: [view("schedule-x", { topic_id: 42 })],
    });
    expect(linked.reviewScheduleRelation).toBe("unknown");
    expect(orphan.reviewScheduleRelation).toBe("unknown");
    expect(malformed.reviewScheduleRelation).toBe("unknown");
    expect(linked.syllabusGaps).toEqual(orphan.syllabusGaps);
    expect(linked.scoreGaps).toEqual(orphan.scoreGaps);
    expect(linked.syllabusGaps).toEqual(malformed.syllabusGaps);
    expect(linked.scoreGaps).toEqual(malformed.scoreGaps);
  });

  it("exposes only projection fields", () => {
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: FULL_CHAIN.exams,
      subjects: FULL_CHAIN.subjects,
      syllabusNodes: FULL_CHAIN.syllabusNodes,
      mockExams: FULL_CHAIN.mockExams,
      scoreRecords: FULL_CHAIN.scoreRecords,
      reviewSchedules: FULL_CHAIN.reviewSchedules,
    });
    expect(Object.keys(projection).sort()).toEqual([
      "examId",
      "reviewScheduleRelation",
      "scoreGaps",
      "status",
      "syllabusGaps",
    ]);
  });

  it("keeps gap projections stable when input arrays mutate afterwards", () => {
    const syllabusNodes = [
      nodeRecord("node-1", "subject-1", { coverage_status: "covered" }),
      nodeRecord("node-2", "subject-1", { coverage_status: "not_started" }),
    ];
    const projection = buildReviewGapProjection({
      examId: "exam-1",
      exams: [examRecord("exam-1")],
      subjects: [subjectRecord("subject-1", "exam-1")],
      syllabusNodes,
      mockExams: [mockRecord("mock-1", "exam-1")],
      scoreRecords: [scoreRecord("score-1", "mock-1")],
      reviewSchedules: [],
    });
    const snapshot = JSON.parse(JSON.stringify(projection));
    syllabusNodes.push(
      nodeRecord("node-3", "subject-1", { coverage_status: "not_started" }),
    );
    syllabusNodes.splice(0, 1);
    expect(projection).toEqual(snapshot);
  });
});
