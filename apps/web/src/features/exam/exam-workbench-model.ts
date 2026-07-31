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
