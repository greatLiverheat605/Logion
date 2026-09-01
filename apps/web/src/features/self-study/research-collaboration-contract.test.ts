import { describe, expect, it } from "vitest";

import {
  collaborationCapabilities,
  isSharedSpace,
  researchPayloadErrors,
  RESEARCH_PARENT_FIELDS,
  RESEARCH_STANCES,
  safeResearchSourceUrl,
  snapshotWriteMode,
} from "./research-collaboration-contract";

describe("research and collaboration formal semantics", () => {
  it("keeps research parent dependencies explicit", () => {
    expect(RESEARCH_PARENT_FIELDS).toEqual({
      research_claim: "paper_id",
      experiment_run: "question_id",
      metric_record: "run_id",
      research_feedback: "claim_id",
    });
    expect(
      researchPayloadErrors("metric_record", { name: "accuracy" }),
    ).toContain("metric_record.run_id is required");
  });

  it("accepts only HTTP(S) paper sources", () => {
    expect(safeResearchSourceUrl("https://example.com/paper")).toBe(
      "https://example.com/paper",
    );
    expect(safeResearchSourceUrl("javascript:alert(1)")).toBeNull();
    expect(
      researchPayloadErrors("paper_record", {
        title: "Paper",
        citation_key: "paper2026",
        source_url: "javascript:alert(1)",
      }),
    ).toContain("paper_record.source_url must be an HTTP(S) URL");
  });

  it("keeps claim stance values aligned with the API contract", () => {
    expect(RESEARCH_STANCES).toEqual([
      "supports",
      "opposes",
      "mixed",
      "unknown",
    ]);
    expect(
      researchPayloadErrors("research_claim", {
        paper_id: "paper-1",
        statement: "A claim",
        stance: "speculative",
      }),
    ).toContain("research_claim.stance is invalid");
  });

  it("excludes private collaboration spaces and exposes role capabilities", () => {
    expect(isSharedSpace("private")).toBe(false);
    expect(isSharedSpace("shared")).toBe(true);
    expect(collaborationCapabilities("reviewer")).toEqual({
      canPlanShared: false,
      canSubmitFeedback: true,
      canPublishSnapshot: false,
    });
    expect(collaborationCapabilities("viewer").canSubmitFeedback).toBe(false);
  });

  it("treats report snapshots as append-only records", () => {
    expect(snapshotWriteMode()).toBe("append-only");
  });
});
