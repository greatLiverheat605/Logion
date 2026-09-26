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

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

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

describe("Review context readiness", () => {
  it.each(["spaceId", "deviceId", "workspaceId"] as const)(
    "blocks creation while %s is unresolved",
    (field) => {
      const value = props(undefined);
      value.context[field] = "";
      render(<ReviewWorkbench {...value} />);
      expect(
        (
          screen.getByRole("button", {
            name: "新建知识点",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      fireEvent.click(screen.getByRole("tab", { name: /周期审查/ }));
      expect(
        (screen.getByRole("button", { name: "创建审查" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    },
  );
});

describe("Review session context", () => {
  it("restores and records the last view in this tab", async () => {
    window.sessionStorage.setItem(
      "logion:workbench-context:review",
      JSON.stringify({ view: "reviews" }),
    );
    render(<ReviewWorkbench {...props(undefined)} />);
    expect(
      screen
        .getByRole("tab", { name: /周期审查/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /错因模式/ }), {
      button: 0,
    });
    await waitFor(() =>
      expect(
        JSON.parse(
          window.sessionStorage.getItem("logion:workbench-context:review") ??
            "{}",
        ).view,
      ).toBe("errors"),
    );
  });

  it("lets the graph anchor win over a restored view", () => {
    window.sessionStorage.setItem(
      "logion:workbench-context:review",
      JSON.stringify({ view: "reviews" }),
    );
    window.history.replaceState(null, "", "/app/review#knowledge-graph");
    render(<ReviewWorkbench {...props(undefined)} />);
    expect(
      screen
        .getByRole("tab", { name: /掌握与图谱/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    window.history.replaceState(null, "", "/");
  });
});

describe("Review deep links", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("selects the knowledge tab for the graph anchor", () => {
    window.history.replaceState(null, "", "/app/review#knowledge-graph");
    render(<ReviewWorkbench {...props(undefined)} />);
    expect(
      screen
        .getByRole("tab", { name: /掌握与图谱/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "图谱" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("follows a later graph anchor navigation", () => {
    render(<ReviewWorkbench {...props(undefined)} />);
    expect(
      screen
        .getByRole("tab", { name: /到期复习/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    act(() => {
      window.history.replaceState(null, "", "/app/review#knowledge-graph");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(
      screen
        .getByRole("tab", { name: /掌握与图谱/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("Review sheet focus return", () => {
  it("returns focus to the cycle review trigger after closing", async () => {
    render(<ReviewWorkbench {...props(undefined)} />);
    fireEvent.click(screen.getByRole("tab", { name: /周期审查/ }));
    const trigger = screen.getByRole("button", { name: "创建审查" });
    trigger.focus();
    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "创建周期审查" });
    fireEvent.click(within(sheet).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

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

describe("Review source links", () => {
  const sources = [
    {
      id: "link-topic",
      noteId: "note-1",
      noteTitle: "Raft 精读",
      spaceId: "space-1",
      state: "valid" as const,
      targetId: "topic-1",
      targetKind: "topic" as const,
    },
    {
      id: "link-quiz",
      noteId: "note-2",
      noteTitle: null,
      spaceId: "space-1",
      state: "deleted" as const,
      targetId: "quiz-1",
      targetKind: "quiz_item" as const,
    },
  ];

  it("lists the sources of the topic and its recall items", () => {
    const value = props(undefined);
    value.data.sourceLinksEnabled = true;
    value.data.sources = sources;
    render(<ReviewWorkbench {...value} />);
    const inspector = screen.getByTestId("review-inspector");
    expect(within(inspector).getByText("来源有效")).toBeTruthy();
    expect(within(inspector).getByText("知识点来自《Raft 精读》")).toBeTruthy();
    expect(within(inspector).getByText("来源已删除")).toBeTruthy();
    const links = within(inspector).getAllByRole("link", { name: "打开原文" });
    // A deleted source has nothing to open.
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "/app/records?workspace=workspace-1&space=space-1&note=note-1&source=link-topic",
    );
  });

  it("hides the section while the server capability is off", () => {
    const value = props(undefined);
    value.data.sources = sources;
    render(<ReviewWorkbench {...value} />);
    expect(
      within(screen.getByTestId("review-inspector")).queryByText("来源有效"),
    ).toBeNull();
  });
});
