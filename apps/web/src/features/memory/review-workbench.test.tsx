import type { JsonObject, LocalEntity } from "@logion/offline";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReviewWorkbench, type ReviewWorkbenchProps } from "./review-workbench";

function view<T extends JsonObject>(
  entityType: string,
  id: string,
  payload: T,
) {
  const entity: LocalEntity = {
    entity_type: entityType,
    entity_id: id,
    workspace_id: "workspace-1",
    payload,
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    created_by: "user-1",
    updated_by: "user-1",
    payload_hash: "test-hash",
    deleted_at: null,
    server_version: 1,
    local_revision: 1,
    sync_status: "clean",
  };
  return { entity, payload };
}

function props(correct: boolean | null | undefined): ReviewWorkbenchProps {
  return {
    context: {
      canEditGraph: true,
      conflicts: 0,
      contextPhase: "ready",
      dataPhase: "ready",
      deviceId: "device-1",
      reviewState: "ready",
      spaceId: "space-1",
      spaces: [],
      status: "已读取",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [],
    },
    data: {
      confirmedMastery: 0,
      dependencies: [],
      dueReviews: 0,
      errorPatterns: [],
      futureReviewLoad: [],
      knowledgeGraph: [],
      mastery: [],
      masteryByTopicId: new Map(),
      masteryRate: 0,
      openPatterns: 0,
      reviewFindings: [],
      reviews: [],
      schedules: [],
      topics: [
        view("topic", "topic-1", {
          title: "测试知识点",
          description: "",
          space_id: "space-1",
        }),
      ],
      quizItems: [
        view("quiz_item", "quiz-1", {
          space_id: "space-1",
          topic_id: "topic-1",
          prompt: "测试问题",
          evaluation_mode: "exact_match" as const,
        }),
      ],
      quizAttempts: [
        view("quiz_attempt", "attempt-1", {
          space_id: "space-1",
          topic_id: "topic-1",
          quiz_item_id: "quiz-1",
          response_text: "回答",
          confidence: 3,
          error_cause: null,
          ...(correct === undefined ? {} : { is_correct: correct }),
        }),
      ],
    },
    actions: {
      addReviewFinding: vi.fn(),
      completeAuditReview: vi.fn(),
      confirmMastery: vi.fn(),
      createAuditReview: vi.fn(),
      createDependency: vi.fn(),
      createQuizItem: vi.fn(),
      createTopic: vi.fn(),
      loadContext: vi.fn(),
      resolveErrorPattern: vi.fn(),
      resolveFinding: vi.fn(),
      submitQuizAttempt: vi.fn(),
      synchronize: vi.fn(),
      unlock: vi.fn(),
      setSpaceId: vi.fn(),
      setWorkspaceId: vi.fn(),
    },
  };
}

describe("latest recall result copy", () => {
  it.each([
    [true, "最近正确"],
    [false, "最近错误"],
    [null, "最近尚未判定"],
    [undefined, "最近尚未判定"],
  ] as const)("renders %s as %s", (correct, label) => {
    const html = renderToStaticMarkup(<ReviewWorkbench {...props(correct)} />);
    expect(html).toContain(label);
    expect(html).not.toMatch(/最近(?:true|false|null|undefined)/);
    if (correct === null || correct === undefined)
      expect(html).not.toContain("最近错误");
  });

  it("keeps an unanswered quiz distinct from a pending judgement", () => {
    const value = props(undefined);
    value.data.quizAttempts = [];
    const html = renderToStaticMarkup(<ReviewWorkbench {...value} />);
    expect(html).toContain("尚未作答");
    expect(html).not.toContain("最近尚未判定");
  });
});
