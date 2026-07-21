const PROTECTED_ENTITY_TYPES = new Set([
  "evidence",
  "learning_goal",
  "note",
  "resource",
  "study_session",
  "task",
  "verification",
]);

export function isProtectedEntityType(entityType: string): boolean {
  return PROTECTED_ENTITY_TYPES.has(entityType);
}
