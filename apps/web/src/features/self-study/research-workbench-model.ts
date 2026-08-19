export interface ResearchLinkInput {
  id: string;
  parentId: unknown;
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

export function finiteMetricValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function submittedMetricValue(value: unknown): number | null {
  return typeof value === "string" && value.trim() !== ""
    ? finiteMetricValue(Number(value))
    : null;
}

function researchParentId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function researchClaimStatus(stance: unknown) {
  if (stance === "supports")
    return {
      relation: "来源支持该声明",
      status: "待验证；当前合同未记录正式或拒绝状态。",
    };
  if (stance === "opposes")
    return {
      relation: "来源反对该声明",
      status: "待验证；当前合同未记录正式或拒绝状态。",
    };
  if (stance === "mixed")
    return {
      relation: "证据存在分歧",
      status: "争议，待验证；当前合同未记录正式或拒绝状态。",
    };
  return {
    relation: "候选声明",
    status: "候选，待验证；当前合同未记录正式或拒绝状态。",
  };
}

export interface ResearchEvidenceProjectionInput {
  paperIds: readonly string[];
  claimLinks: readonly ResearchLinkInput[];
  questionIds: readonly string[];
  runLinks: readonly ResearchLinkInput[];
  metricLinks: readonly ResearchLinkInput[];
  feedbackLinks: readonly ResearchLinkInput[];
}

function linkedIds(
  parentIds: readonly string[],
  links: readonly ResearchLinkInput[],
): string[] {
  const parents = new Set(parentIds);
  return links.flatMap((link) => {
    const parentId = researchParentId(link.parentId);
    return parentId !== null && parents.has(parentId) ? [link.id] : [];
  });
}

export function buildResearchEvidenceProjection({
  paperIds,
  claimLinks,
  questionIds,
  runLinks,
  metricLinks,
  feedbackLinks,
}: ResearchEvidenceProjectionInput) {
  const claimIds = linkedIds(paperIds, claimLinks);
  const runIds = linkedIds(questionIds, runLinks);
  return {
    claimIds,
    runIds,
    metricIds: linkedIds(runIds, metricLinks),
    feedbackIds: linkedIds(claimIds, feedbackLinks),
  };
}

export function researchQuestionCoverage(
  questionIds: readonly string[],
  runs: readonly ResearchLinkInput[],
): number | null {
  if (questionIds.length === 0) return null;
  const validQuestions = new Set(questionIds);
  const coveredQuestions = new Set(
    runs.flatMap((run) => {
      const parentId = researchParentId(run.parentId);
      return parentId !== null && validQuestions.has(parentId)
        ? [parentId]
        : [];
    }),
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
