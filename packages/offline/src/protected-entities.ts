const PROTECTED_ENTITY_TYPES = new Set([
  "evidence",
  "learning_goal",
  "mastery",
  "note",
  "resource",
  "review_schedule",
  "study_session",
  "task",
  "topic",
  "topic_dependency",
  "verification",
]);

export function isProtectedEntityType(entityType: string): boolean {
  return PROTECTED_ENTITY_TYPES.has(entityType);
}
