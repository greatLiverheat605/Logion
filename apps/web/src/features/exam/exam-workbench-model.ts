export interface ExamScoreInput {
  completed_at: string;
  score: number;
  score_scale_max: number;
}

export function normalizeExamScores(
  scores: readonly ExamScoreInput[],
): number[] {
  return [...scores]
    .filter(
      (item) =>
        item.score_scale_max > 0 &&
        Number.isFinite(item.score) &&
        !Number.isNaN(new Date(item.completed_at).getTime()),
    )
    .sort(
      (left, right) =>
        new Date(left.completed_at).getTime() -
        new Date(right.completed_at).getTime(),
    )
    .map((item) => (item.score / item.score_scale_max) * 100);
}

export function examCoverageRate(
  nodes: readonly { coverage_status: string }[],
): number | null {
  if (nodes.length === 0) return null;
  return (
    (nodes.filter((node) => node.coverage_status === "covered").length /
      nodes.length) *
    100
  );
}

const DAY_MS = 86_400_000;
const COVERAGE_STATUSES = new Set(["not_started", "in_progress", "covered"]);

/**
 * Structural view of an offline exam-domain record. `entity.entity_id` is the
 * object's real primary key; the model never mutates or replaces it.
 */
export interface ExamWorkbenchRecord {
  entity: { entity_id: unknown };
  payload: unknown;
}

function recordId(record: ExamWorkbenchRecord): string | null {
  const id = record.entity.entity_id;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

function linkedId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isRealNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function payloadOf(record: ExamWorkbenchRecord): Record<string, unknown> {
  if (typeof record.payload === "object" && record.payload !== null) {
    return record.payload as Record<string, unknown>;
  }
  return {};
}

/* ---------------------------------------------------------------------------
 * Exam schedule descriptor
 * ------------------------------------------------------------------------- */

export type ExamScheduleDescriptor =
  | { status: "undetermined"; label: string }
  | {
      status: "past";
      label: string;
      examAt: string;
      timestamp: number;
    }
  | {
      status: "upcoming";
      label: string;
      examAt: string;
      timestamp: number;
      daysRemaining: number;
    };

/**
 * Missing, malformed, or unparseable exam dates always fall back to
 * "待定"; the descriptor never invents a date or a countdown.
 */
export function examScheduleDescriptor(
  examAt: unknown,
  now: number | Date = Date.now(),
): ExamScheduleDescriptor {
  const timestamp = parseTimestamp(examAt);
  if (timestamp === null) {
    return { status: "undetermined", label: "考试日期待定" };
  }
  const reference = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(reference)) {
    return { status: "undetermined", label: "考试日期待定" };
  }
  const difference = timestamp - reference;
  if (difference <= 0) {
    return {
      status: "past",
      label: "考试时间已到或已过去",
      examAt: examAt as string,
      timestamp,
    };
  }
  return {
    status: "upcoming",
    label: `剩余 ${Math.ceil(difference / DAY_MS)} 天`,
    examAt: examAt as string,
    timestamp,
    daysRemaining: Math.ceil(difference / DAY_MS),
  };
}

/* ---------------------------------------------------------------------------
 * Exam coverage projection
 * ------------------------------------------------------------------------- */

export interface ExamCoverageProjection {
  examId: string;
  subjectCount: number;
  nodeCount: number;
  coveredCount: number;
  coverageRate: number | null;
}

function findExam(
  examId: unknown,
  exams: readonly ExamWorkbenchRecord[],
): { examId: string; payload: Record<string, unknown> } | null {
  const id = linkedId(examId);
  if (id === null) return null;
  for (const exam of exams) {
    if (recordId(exam) === id) {
      return { examId: id, payload: payloadOf(exam) };
    }
  }
  return null;
}

function admissibleSubjectIds(
  examId: string,
  subjects: readonly ExamWorkbenchRecord[],
): Set<string> {
  const ids = new Set<string>();
  for (const subject of subjects) {
    const id = recordId(subject);
    if (id === null) continue;
    if (linkedId(payloadOf(subject).exam_id) === examId) {
      ids.add(id);
    }
  }
  return ids;
}

interface AdmissibleNode {
  nodeId: string;
  subjectId: string;
  coverageStatus: string;
}

interface NodeCandidate {
  subjectId: string;
  coverageStatus: string;
  parentId: string | null;
}

/**
 * Only nodes whose subject really belongs to the exam, whose coverage status
 * is a real enum value, and whose parent either does not exist (top level) or
 * resolves to another admissible node of the same subject enter the stats.
 * Orphaned, malformed, or dangling-parent records are dropped, and dropping a
 * parent cascades to its children.
 */
function admissibleNodes(
  examId: string,
  subjects: readonly ExamWorkbenchRecord[],
  syllabusNodes: readonly ExamWorkbenchRecord[],
): AdmissibleNode[] {
  const subjectIds = admissibleSubjectIds(examId, subjects);
  const nodeIdCounts = new Map<string, number>();
  for (const node of syllabusNodes) {
    const nodeId = recordId(node);
    if (nodeId !== null) {
      nodeIdCounts.set(nodeId, (nodeIdCounts.get(nodeId) ?? 0) + 1);
    }
  }
  const candidates = new Map<string, NodeCandidate>();
  for (const node of syllabusNodes) {
    const nodeId = recordId(node);
    const payload = payloadOf(node);
    const subjectId = linkedId(payload.subject_id);
    if (
      nodeId === null ||
      nodeIdCounts.get(nodeId) !== 1 ||
      subjectId === null ||
      !subjectIds.has(subjectId)
    ) {
      continue;
    }
    const parentId =
      payload.parent_id === null ? null : linkedId(payload.parent_id);
    if (payload.parent_id !== null && parentId === null) continue;
    const coverageStatus = payload.coverage_status;
    if (
      typeof coverageStatus !== "string" ||
      !COVERAGE_STATUSES.has(coverageStatus)
    ) {
      continue;
    }
    candidates.set(nodeId, { subjectId, coverageStatus, parentId });
  }
  const acyclic = new Set<string>();
  for (const nodeId of candidates.keys()) {
    const visited = new Set<string>();
    let current: string | null = nodeId;
    let valid = true;
    while (current !== null) {
      if (visited.has(current)) {
        valid = false;
        break;
      }
      visited.add(current);
      current = candidates.get(current)?.parentId ?? null;
    }
    if (valid) acyclic.add(nodeId);
  }
  for (const nodeId of candidates.keys()) {
    if (!acyclic.has(nodeId)) candidates.delete(nodeId);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nodeId, info] of candidates) {
      if (info.parentId === null) continue;
      const parent = candidates.get(info.parentId);
      if (parent === undefined || parent.subjectId !== info.subjectId) {
        candidates.delete(nodeId);
        changed = true;
      }
    }
  }
  return [...candidates.entries()].map(([nodeId, info]) => ({
    nodeId,
    subjectId: info.subjectId,
    coverageStatus: info.coverageStatus,
  }));
}

/**
 * Coverage over the real Exam → Subject → SyllabusNode chain. Returns null
 * when the exam itself cannot be resolved. An empty syllabus yields a null
 * coverage rate (unknown), never a fabricated 0%.
 */
export function buildExamCoverageProjection(input: {
  examId: unknown;
  exams: readonly ExamWorkbenchRecord[];
  subjects: readonly ExamWorkbenchRecord[];
  syllabusNodes: readonly ExamWorkbenchRecord[];
}): ExamCoverageProjection | null {
  const exam = findExam(input.examId, input.exams);
  if (exam === null) return null;
  const nodes = admissibleNodes(
    exam.examId,
    input.subjects,
    input.syllabusNodes,
  );
  return {
    examId: exam.examId,
    subjectCount: admissibleSubjectIds(exam.examId, input.subjects).size,
    nodeCount: nodes.length,
    coveredCount: nodes.filter((node) => node.coverageStatus === "covered")
      .length,
    coverageRate:
      nodes.length === 0
        ? null
        : (nodes.filter((node) => node.coverageStatus === "covered").length /
            nodes.length) *
          100,
  };
}

/* ---------------------------------------------------------------------------
 * Score trend
 * ------------------------------------------------------------------------- */

export interface ScoreTrendPoint {
  scoreId: string;
  completedAt: string;
  timestamp: number;
  score: number;
  scoreScaleMax: number;
  normalizedPercent: number;
}

export type ScoreTrend =
  | { status: "ok"; points: ScoreTrendPoint[] }
  | { status: "unknown" };

function admissibleScorePoints(
  examId: string,
  mockExams: readonly ExamWorkbenchRecord[],
  scoreRecords: readonly ExamWorkbenchRecord[],
): ScoreTrendPoint[] {
  const mockIds = new Set<string>();
  for (const mock of mockExams) {
    const id = recordId(mock);
    if (id === null) continue;
    if (linkedId(payloadOf(mock).exam_id) === examId) {
      mockIds.add(id);
    }
  }
  const points: ScoreTrendPoint[] = [];
  for (const record of scoreRecords) {
    const scoreId = recordId(record);
    const payload = payloadOf(record);
    const mockExamId = linkedId(payload.mock_exam_id);
    if (scoreId === null || mockExamId === null || !mockIds.has(mockExamId)) {
      continue;
    }
    const score = payload.score;
    const scale = payload.score_scale_max;
    if (!isRealNumber(score) || score < 0) continue;
    if (!isRealNumber(scale) || scale <= 0) continue;
    if (score > scale) continue;
    const timestamp = parseTimestamp(payload.completed_at);
    if (timestamp === null) continue;
    points.push({
      scoreId,
      completedAt: payload.completed_at as string,
      timestamp,
      score,
      scoreScaleMax: scale,
      normalizedPercent: (score / scale) * 100,
    });
  }
  points.sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      (left.scoreId < right.scoreId
        ? -1
        : left.scoreId > right.scoreId
          ? 1
          : 0),
  );
  return points;
}

/**
 * Trend over real score records linked through real mock exams of the exam.
 * Scores without a real source (mock/exam chain), a parseable completion
 * time, or finite numeric values are excluded; with no admissible sample the
 * trend is explicitly unknown. No interpolation or forecasting.
 */
export function buildScoreTrend(input: {
  examId: unknown;
  exams: readonly ExamWorkbenchRecord[];
  mockExams: readonly ExamWorkbenchRecord[];
  scoreRecords: readonly ExamWorkbenchRecord[];
}): ScoreTrend {
  const exam = findExam(input.examId, input.exams);
  if (exam === null) return { status: "unknown" };
  const points = admissibleScorePoints(
    exam.examId,
    input.mockExams,
    input.scoreRecords,
  );
  if (points.length === 0) return { status: "unknown" };
  return { status: "ok", points };
}

/* ---------------------------------------------------------------------------
 * Review gap projection
 * ------------------------------------------------------------------------- */

export interface SyllabusReviewGap {
  kind: "uncovered_syllabus_node";
  nodeId: string;
}

export interface ScoreReviewGap {
  kind: "score_below_target";
  scoreId: string;
  normalizedPercent: number;
}

export interface ReviewGapProjection {
  status: "unknown" | "ok";
  examId: string | null;
  syllabusGaps: SyllabusReviewGap[];
  scoreGaps: ScoreReviewGap[];
  /**
   * Contract gap (recorded, not fabricated): review schedules belong to the
   * memory domain and reference `topic_id`; no existing field links them to
   * exam, subject, syllabus node, mock exam, or score objects. Linkage is
   * therefore reported as unknown and review schedules never enter gap stats.
   */
  reviewScheduleRelation: "unknown";
}

/**
 * Gaps are identified only from real syllabus coverage and real scores that
 * resolve through the exam chain. A missing exam yields an explicit unknown
 * projection; missing target-score data yields an empty score-gap list
 * rather than a fabricated verdict.
 */
export function buildReviewGapProjection(input: {
  examId: unknown;
  exams: readonly ExamWorkbenchRecord[];
  subjects: readonly ExamWorkbenchRecord[];
  syllabusNodes: readonly ExamWorkbenchRecord[];
  mockExams: readonly ExamWorkbenchRecord[];
  scoreRecords: readonly ExamWorkbenchRecord[];
  reviewSchedules: readonly ExamWorkbenchRecord[];
}): ReviewGapProjection {
  void input.reviewSchedules;
  const exam = findExam(input.examId, input.exams);
  if (exam === null) {
    return {
      status: "unknown",
      examId: null,
      syllabusGaps: [],
      scoreGaps: [],
      reviewScheduleRelation: "unknown",
    };
  }
  const nodes = admissibleNodes(
    exam.examId,
    input.subjects,
    input.syllabusNodes,
  );
  const syllabusGaps: SyllabusReviewGap[] = nodes
    .filter((node) => node.coverageStatus !== "covered")
    .map((node) => ({
      kind: "uncovered_syllabus_node" as const,
      nodeId: node.nodeId,
    }));
  const scoreGaps: ScoreReviewGap[] = [];
  const target = exam.payload.target_score;
  const scale = exam.payload.score_scale_max;
  if (
    isRealNumber(target) &&
    target >= 0 &&
    isRealNumber(scale) &&
    scale > 0 &&
    target <= scale
  ) {
    const normalizedTarget = (target / scale) * 100;
    for (const point of admissibleScorePoints(
      exam.examId,
      input.mockExams,
      input.scoreRecords,
    )) {
      if (point.normalizedPercent < normalizedTarget) {
        scoreGaps.push({
          kind: "score_below_target",
          scoreId: point.scoreId,
          normalizedPercent: point.normalizedPercent,
        });
      }
    }
  }
  return {
    status: "ok",
    examId: exam.examId,
    syllabusGaps,
    scoreGaps,
    reviewScheduleRelation: "unknown",
  };
}
