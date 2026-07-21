const PROTECTED_ENTITY_TYPES = new Set([
  "learning_goal",
  "note",
  "resource",
  "study_session",
  "task",
]);

export function isProtectedEntityType(entityType: string): boolean {
  return PROTECTED_ENTITY_TYPES.has(entityType);
}
