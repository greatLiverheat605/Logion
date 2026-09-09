/** @vitest-environment jsdom */

import type { JsonObject, LocalEntity } from "@logion/offline";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewWorkbench, type ReviewWorkbenchProps } from "./review-workbench";

afterEach(cleanup);

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

describe("recall answer lifecycle", () => {
  it("keeps a reopened draft when an earlier save finishes", async () => {
    const value = props(undefined);
    let finishSave!: (result: boolean) => void;
    const pendingSave = new Promise<boolean>((resolve) => {
      finishSave = resolve;
    });
    value.actions.submitQuizAttempt = vi.fn().mockReturnValue(pendingSave);
    render(<ReviewWorkbench {...value} />);
    const startRecall = within(screen.getByTestId("review-answer")).getByRole(
      "button",
      { name: "开始回忆" },
    );
    fireEvent.click(startRecall);
    const first = within(screen.getByRole("dialog", { name: "主动回忆" }));
    fireEvent.change(first.getByLabelText("我的答案"), {
      target: { value: "第一次回答" },
    });
    fireEvent.click(first.getByRole("button", { name: "提交回答" }));
    fireEvent.click(first.getByRole("button", { name: "保存答题记录" }));
    fireEvent.click(first.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(startRecall);
    const reopened = screen.getByRole("dialog", { name: "主动回忆" });
    fireEvent.change(within(reopened).getByLabelText("我的答案"), {
      target: { value: "新的未保存草稿" },
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => finishSave(true));
      await act(async () => vi.runOnlyPendingTimersAsync());
      expect(screen.getByRole("dialog", { name: "主动回忆" })).toBe(reopened);
      expect(
        (within(reopened).getByLabelText("我的答案") as HTMLTextAreaElement)
          .value,
      ).toBe("新的未保存草稿");
      expect(value.actions.submitQuizAttempt).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the same quiz with a blank answer after a successful save", async () => {
    const value = props(undefined);
    value.actions.submitQuizAttempt = vi.fn().mockResolvedValue(true);
    render(<ReviewWorkbench {...value} />);
    const startRecall = within(screen.getByTestId("review-answer")).getByRole(
      "button",
      { name: "开始回忆" },
    );
    fireEvent.click(startRecall);
    const answer = within(screen.getByRole("dialog", { name: "主动回忆" }));
    fireEvent.change(answer.getByLabelText("我的答案"), {
      target: { value: "第一次回答" },
    });
    fireEvent.click(answer.getByRole("button", { name: "提交回答" }));
    fireEvent.click(answer.getByRole("button", { name: "保存答题记录" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(startRecall);
    const reopened = within(screen.getByRole("dialog", { name: "主动回忆" }));
    expect(reopened.getByRole("button", { name: "提交回答" })).toBeTruthy();
    expect(
      (reopened.getByLabelText("我的答案") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(reopened.queryByLabelText("信心（1-5）")).toBeNull();
    expect(value.actions.submitQuizAttempt).toHaveBeenCalledTimes(1);
  });

  it("preserves an unsaved answer after failure and resets it after dismissal", async () => {
    const value = props(undefined);
    value.actions.submitQuizAttempt = vi.fn().mockResolvedValue(false);
    render(<ReviewWorkbench {...value} />);
    const startRecall = within(screen.getByTestId("review-answer")).getByRole(
      "button",
      { name: "开始回忆" },
    );
    fireEvent.click(startRecall);
    const dialog = screen.getByRole("dialog", { name: "主动回忆" });
    const answer = within(dialog);
    fireEvent.change(answer.getByLabelText("我的答案"), {
      target: { value: "待保存回答" },
    });
    fireEvent.click(answer.getByRole("button", { name: "提交回答" }));
    await act(async () => {
      fireEvent.click(answer.getByRole("button", { name: "保存答题记录" }));
    });
    expect(value.actions.submitQuizAttempt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "主动回忆" })).toBe(dialog);
    expect(answer.getByRole("button", { name: "保存答题记录" })).toBeTruthy();
    expect(
      (answer.getByLabelText("我的答案") as HTMLTextAreaElement).value,
    ).toBe("待保存回答");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(startRecall);
    const reopened = within(screen.getByRole("dialog", { name: "主动回忆" }));
    expect(reopened.getByRole("button", { name: "提交回答" })).toBeTruthy();
    expect(
      (reopened.getByLabelText("我的答案") as HTMLTextAreaElement).value,
    ).toBe("");
  });
});

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

describe("mastery suggestion reason", () => {
  function withReason(reason: string | null | undefined) {
    const value = props(undefined);
    const mastery = view("mastery", "mastery-1", {
      space_id: "space-1",
      topic_id: "topic-1",
      suggested_level: "practicing" as const,
      suggested_reason: "",
      suggested_at: null,
      confirmed_level: "exposed" as const,
      confirmed_at: null,
    });
    // 覆盖运行时的 null 和缺失字段，不只依赖合同中的 string 类型。
    Object.assign(mastery.payload, { suggested_reason: reason });
    value.data.mastery = [mastery];
    return value;
  }

  it("renders the reason without changing either mastery level", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkbench {...withReason("最近三次回忆正确，建议继续练习。")} />,
    );
    expect(html).toContain("<dt>建议依据</dt>");
    expect(html).toContain("<dd>最近三次回忆正确，建议继续练习。</dd>");
    expect(html).toContain("<dd>已经接触</dd>");
    expect(html).toContain("<dd>正在练习</dd>");
  });

  it.each(["", null, undefined, " \n\t "])(
    "omits the reason row for %s",
    (reason) => {
      const html = renderToStaticMarkup(
        <ReviewWorkbench {...withReason(reason)} />,
      );
      expect(html).not.toContain("建议依据");
      expect(html).toContain("<dd>已经接触</dd>");
      expect(html).toContain("<dd>正在练习</dd>");
    },
  );
});
