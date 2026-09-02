export interface ExamScoreInput {
  completed_at: string;
  score: number;
  score_scale_max: number;
}

/**
 * The Exam route has five protected entity types. Keep this list explicit so
 * view work cannot accidentally introduce a fixture-only object.
 */
export const EXAM_ENTITY_TYPES = [
  "exam",
  "exam_subject",
  "syllabus_node",
  "mock_exam",
  "score_record",
] as const;

export const EXAM_WORKBENCH_REGIONS = [
  "exam-list",
  "exam-coverage",
  "exam-syllabus",
  "exam-mocks",
  "exam-weaknesses",
] as const;

export type ExamDateStatus = "scheduled" | "undetermined";

export interface ExamPayloadInput {
  dateStatus: ExamDateStatus;
  examAt: string;
  scoreScaleMax: string;
  targetScore: string;
  title: string;
  timezone: string;
}

function localDateTimeToISOString(value: string, timezone: string): string {
  const wallTime = new Date(`${value}Z`);
  if (!Number.isFinite(wallTime.getTime())) {
    throw new RangeError("Invalid exam date");
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(wallTime)
      .map(({ type, value: part }) => [type, part]),
  );
  const projectedWallTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    wallTime.getUTCMilliseconds(),
  );
  const offset = projectedWallTime - wallTime.getTime();
  return new Date(wallTime.getTime() - offset).toISOString();
}

export function buildExamPayload(input: ExamPayloadInput) {
  const targetScore = input.targetScore.trim();
  const scoreScaleMax = input.scoreScaleMax.trim();
  return {
    date_status: input.dateStatus,
    exam_at:
      input.dateStatus === "scheduled" && input.examAt
        ? localDateTimeToISOString(input.examAt, input.timezone)
        : null,
    score_scale_max: scoreScaleMax ? Number(scoreScaleMax) : null,
    status: "planning" as const,
    target_score: targetScore ? Number(targetScore) : null,
    timezone: input.dateStatus === "scheduled" ? input.timezone : null,
    title: input.title.trim(),
  };
}

export function validateExamScorePair(
  targetScore: string,
  scoreScaleMax: string,
): string | null {
  const hasTarget = targetScore.trim().length > 0;
  const hasScale = scoreScaleMax.trim().length > 0;
  if (hasTarget !== hasScale) return "目标分与满分必须成对填写。";
  if (hasTarget && Number(targetScore) > Number(scoreScaleMax)) {
    return "目标分不能高于满分。";
  }
  return null;
}

export function examCountdown(examAt: string | null, now = Date.now()): string {
  if (examAt === null) return "日期待定";
  const timestamp = new Date(examAt).getTime();
  if (!Number.isFinite(timestamp)) return "日期无效";
  const difference = timestamp - now;
  if (difference <= 0) return "考试时间已到或已过去";
  return `剩余 ${Math.ceil(difference / 86_400_000)} 天`;
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
