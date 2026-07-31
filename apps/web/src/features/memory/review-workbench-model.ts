export interface ReviewScheduleInput {
  next_review_at: string;
  status: string;
}

export interface KnowledgeTopicInput {
  description: string;
  id: string;
  title: string;
}

export interface KnowledgeDependencyInput {
  dependent_topic_id: string;
  prerequisite_topic_id: string;
}

export interface KnowledgeGraphNode extends KnowledgeTopicInput {
  dependents: string[];
  prerequisites: string[];
}

export function buildKnowledgeGraph(
  topics: readonly KnowledgeTopicInput[],
  dependencies: readonly KnowledgeDependencyInput[],
): KnowledgeGraphNode[] {
  const titleById = new Map(topics.map((topic) => [topic.id, topic.title]));
  return topics.map((topic) => ({
    ...topic,
    dependents: dependencies.flatMap((dependency) =>
      dependency.prerequisite_topic_id === topic.id &&
      titleById.has(dependency.dependent_topic_id)
        ? [titleById.get(dependency.dependent_topic_id)!]
        : [],
    ),
    prerequisites: dependencies.flatMap((dependency) =>
      dependency.dependent_topic_id === topic.id &&
      titleById.has(dependency.prerequisite_topic_id)
        ? [titleById.get(dependency.prerequisite_topic_id)!]
        : [],
    ),
  }));
}

export function buildSevenDayReviewLoad(
  schedules: readonly ReviewScheduleInput[],
  now: Date,
): { label: string; value: number }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const result = Array.from({ length: 7 }, (_, index) => ({
    label: index === 0 ? "今天" : `+${index} 天`,
    value: 0,
  }));

  for (const schedule of schedules) {
    if (schedule.status === "completed" || schedule.status === "skipped") {
      continue;
    }
    const dueAt = new Date(schedule.next_review_at);
    if (Number.isNaN(dueAt.getTime())) continue;
    const offset = Math.max(
      0,
      Math.floor((dueAt.getTime() - start.getTime()) / 86_400_000),
    );
    if (offset < result.length) result[offset]!.value += 1;
  }
  return result;
}
