export interface PlanningPhaseInput {
  acceptance_criteria: readonly string[];
  description: string;
  estimated_minutes: number;
  id: string;
  position: number;
  title: string;
}

export interface PlanningPhaseSequenceItem extends PlanningPhaseInput {
  priorPhaseTitle: string | null;
}

export function buildPlanningPhaseSequence(
  phases: readonly PlanningPhaseInput[],
): PlanningPhaseSequenceItem[] {
  const ordered = [...phases].sort(
    (left, right) =>
      left.position - right.position || left.title.localeCompare(right.title),
  );
  return ordered.map((phase, index) => ({
    ...phase,
    priorPhaseTitle: ordered[index - 1]?.title ?? null,
  }));
}
