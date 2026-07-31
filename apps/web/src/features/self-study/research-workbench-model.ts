export interface ResearchLinkInput {
  id: string;
  parentId: string | null;
}

export interface ResearchRunInput {
  id: string;
  title: string;
}

export interface ResearchMetricInput {
  id: string;
  name: string;
  runId: string;
  unit: string;
  value: number;
}

export function researchQuestionCoverage(
  questionIds: readonly string[],
  runs: readonly ResearchLinkInput[],
): number | null {
  if (questionIds.length === 0) return null;
  const validQuestions = new Set(questionIds);
  const coveredQuestions = new Set(
    runs.flatMap((run) =>
      run.parentId && validQuestions.has(run.parentId) ? [run.parentId] : [],
    ),
  );
  return (coveredQuestions.size / questionIds.length) * 100;
}

export function buildMetricComparison(
  runs: readonly ResearchRunInput[],
  metrics: readonly ResearchMetricInput[],
) {
  const runTitleById = new Map(runs.map((run) => [run.id, run.title]));
  const grouped = new Map<
    string,
    {
      name: string;
      unit: string;
      values: { runTitle: string; value: number }[];
    }
  >();
  for (const metric of metrics) {
    const runTitle = runTitleById.get(metric.runId);
    if (!runTitle || !Number.isFinite(metric.value)) continue;
    const key = `${metric.name}\u0000${metric.unit}`;
    const group = grouped.get(key) ?? {
      name: metric.name,
      unit: metric.unit,
      values: [],
    };
    group.values.push({ runTitle, value: metric.value });
    grouped.set(key, group);
  }
  return [...grouped.values()].filter((group) => group.values.length > 1);
}
