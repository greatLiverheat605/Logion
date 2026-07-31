export function eligibleCollaborationSpaces<
  T extends { visibility: "private" | "shared" },
>(spaces: readonly T[]): T[] {
  return spaces.filter((space) => space.visibility === "shared");
}
