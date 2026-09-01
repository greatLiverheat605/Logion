import type { JsonObject } from "@logion/offline";

export const RESEARCH_ENTITY_TYPES = [
  "paper_record",
  "research_claim",
  "research_question",
  "experiment_run",
  "metric_record",
  "research_feedback",
] as const;

export type ResearchEntityType = (typeof RESEARCH_ENTITY_TYPES)[number];

export const RESEARCH_STANCES = [
  "supports",
  "opposes",
  "mixed",
  "unknown",
] as const;

export const RESEARCH_PARENT_FIELDS: Readonly<
  Partial<Record<ResearchEntityType, string>>
> = {
  research_claim: "paper_id",
  experiment_run: "question_id",
  metric_record: "run_id",
  research_feedback: "claim_id",
};

export const RESEARCH_LAYOUT_REGIONS = [
  "research-tabs",
  "research-questions",
  "research-claims",
  "research-evidence",
  "research-experiments",
] as const;

export const COLLABORATION_ENTITY_TYPES = [
  "rubric",
  "group_review",
  "group_feedback",
  "report_snapshot",
] as const;

export type CollaborationEntityType =
  (typeof COLLABORATION_ENTITY_TYPES)[number];

export const COLLABORATION_LAYOUT_REGIONS = [
  "collaboration-reviews",
  "collaboration-rubric",
  "collaboration-feedback",
  "collaboration-members",
] as const;

export type CollaborationRole =
  | "owner"
  | "admin"
  | "editor"
  | "reviewer"
  | "contributor"
  | "viewer";

export function safeResearchSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function researchPayloadErrors(
  kind: ResearchEntityType,
  payload: JsonObject,
): string[] {
  const errors: string[] = [];
  if (
    kind === "paper_record" &&
    safeResearchSourceUrl(payload.source_url) === null &&
    payload.source_url != null &&
    payload.source_url !== ""
  ) {
    errors.push("paper_record.source_url must be an HTTP(S) URL");
  }
  const parentField = RESEARCH_PARENT_FIELDS[kind];
  if (parentField && typeof payload[parentField] !== "string") {
    errors.push(`${kind}.${parentField} is required`);
  }
  if (
    kind === "research_claim" &&
    !RESEARCH_STANCES.includes(
      String(payload.stance) as (typeof RESEARCH_STANCES)[number],
    )
  ) {
    errors.push("research_claim.stance is invalid");
  }
  return errors;
}

export function collaborationCapabilities(role: CollaborationRole | undefined) {
  const canPlan = role === "owner" || role === "admin" || role === "editor";
  return {
    canPlanShared: canPlan,
    canSubmitFeedback: canPlan || role === "reviewer" || role === "contributor",
    canPublishSnapshot: canPlan,
  };
}

export function isSharedSpace(visibility: "private" | "shared"): boolean {
  return visibility === "shared";
}

export function snapshotWriteMode(): "append-only" {
  return "append-only";
}
