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

export interface PlanningGoalPayloadInput {
  description: string;
  desired_outcome: string;
  phases: readonly PlanningPhaseInput[];
  space_id: string;
  target_date: string | null;
  title: string;
  weekly_minutes: number;
}

export interface PlanningGoalRecord {
  id: string;
  payload: PlanningGoalPayloadInput;
  syncStatus: string;
  updatedAt: string;
}

export interface PlanningTaskPayloadInput {
  estimated_minutes: number;
  goal_id: string;
  phase_id: string | null;
  space_id: string;
  status: string;
  title: string;
}

export interface PlanningTaskRecord {
  id: string;
  payload: PlanningTaskPayloadInput;
  syncStatus: string;
  updatedAt: string;
}

export interface PlanningDerivedViewModel {
  missingAcceptanceCriteria: number;
  phaseSequence: PlanningPhaseSequenceItem[];
  plannedMinutes: number;
  readiness: number;
  selectedGoal?: PlanningGoalRecord;
  tasks: PlanningTaskRecord[];
  tasksByPhase: Readonly<Record<string, PlanningTaskRecord[]>>;
  unassignedTasks: PlanningTaskRecord[];
  visibleGoals: PlanningGoalRecord[];
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

export function derivePlanningViewModel({
  goals,
  selectedGoalId,
  spaceId,
  tasks,
}: Readonly<{
  goals: readonly PlanningGoalRecord[];
  selectedGoalId: string;
  spaceId: string;
  tasks: readonly PlanningTaskRecord[];
}>): PlanningDerivedViewModel {
  const visibleGoals = goals
    .filter((goal) => goal.payload.space_id === spaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selectedGoal =
    visibleGoals.find((goal) => goal.id === selectedGoalId) ?? visibleGoals[0];
  const phaseSequence = buildPlanningPhaseSequence(
    selectedGoal?.payload.phases ?? [],
  );
  const visibleTasks = tasks
    .filter(
      (task) =>
        task.payload.space_id === spaceId &&
        task.payload.goal_id === selectedGoal?.id,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const tasksByPhase = Object.fromEntries(
    phaseSequence.map((phase) => [
      phase.id,
      visibleTasks.filter((task) => task.payload.phase_id === phase.id),
    ]),
  );
  const missingAcceptanceCriteria = phaseSequence.filter(
    (phase) =>
      phase.acceptance_criteria.length === 0 ||
      phase.acceptance_criteria.every((criterion) => criterion.trim() === ""),
  ).length;
  const readinessChecks = selectedGoal
    ? [
        selectedGoal.payload.title.trim() !== "",
        selectedGoal.payload.desired_outcome.trim() !== "",
        selectedGoal.payload.weekly_minutes > 0,
        phaseSequence.length > 0,
        missingAcceptanceCriteria === 0,
      ]
    : [];

  return {
    missingAcceptanceCriteria,
    phaseSequence,
    plannedMinutes: phaseSequence.reduce(
      (total, phase) => total + phase.estimated_minutes,
      0,
    ),
    readiness: readinessChecks.filter(Boolean).length * 20,
    selectedGoal,
    tasks: visibleTasks,
    tasksByPhase,
    unassignedTasks: visibleTasks.filter(
      (task) => task.payload.phase_id === null,
    ),
    visibleGoals,
  };
}
