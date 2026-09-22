/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { LocalEntity } from "@logion/offline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordsWorkbench } from "./records-workbench";
import type {
  RecordsControllerResult,
  RecordsLocalView,
  RecordsNotePayload,
} from "./use-records-controller";

const capabilityRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
  return { ...actual, browserApiClient: { request: capabilityRequest } };
});
afterEach(cleanup);

beforeEach(() => {
  capabilityRequest.mockReset().mockResolvedValue({ ingest_enabled: true });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

function note(
  id: string,
  title: string,
  markdown: string,
): RecordsLocalView<RecordsNotePayload> {
  return {
    entity: {
      entity_id: id,
      local_revision: 2,
      server_version: 4,
      sync_status: "clean",
      updated_at: "2026-08-26T08:00:00.000Z",
    } as LocalEntity,
    payload: {
      markdown_body: markdown,
      space_id: "space-1",
      task_id: id === "note-1" ? "task-1" : null,
      title,
    },
  };
}

function controllerFixture() {
  const first = note(
    "note-1",
    "Raft 精读",
    "# Raft\n\n<script>alert(1)</script>\n\nhttps://example.com\n\njavascript:alert(1)",
  );
  const second = note("note-2", "一致性模型", "# Consistency");
  const commands = {
    selectionTopics: vi.fn(async () => [{ id: "topic-1", title: "共识" }]),
    createFromSelection: vi.fn(async () => true),
    createNote: vi.fn(async () => "note-3"),
    createResource: vi.fn(async () => true),
    loadContext: vi.fn(async () => undefined),
    queueAttachment: vi.fn(async () => true),
    renameResource: vi.fn(async () => true),
    saveNote: vi.fn(async () => true),
    selectNote: vi.fn(),
    reportDeletion: vi.fn(),
    setSpaceId: vi.fn(),
    setWorkspaceId: vi.fn(),
    synchronize: vi.fn(async () => true),
    unlock: vi.fn(async () => true),
  };
  const controller: RecordsControllerResult = {
    capabilities: {
      canCreate: true,
      canSync: true,
      canUnlock: false,
      canWrite: true,
    },
    commands,
    context: {
      online: true,
      operational: {
        permission: { label: "owner", tone: "good" },
        space: { id: "space-1", name: "学习笔记" },
        sync: { label: "已同步", tone: "good" },
        vault: { label: "已解锁", tone: "good" },
        workspace: { id: "workspace-1", name: "Logion" },
      },
      operationalState: null,
      spaceId: "space-1",
      spaces: [
        { id: "space-1", name: "学习笔记" },
      ] as RecordsControllerResult["context"]["spaces"],
      status: "本地资料已解锁。",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [
        { id: "workspace-1", name: "Logion", role: "owner" },
      ] as RecordsControllerResult["context"]["workspaces"],
    },
    viewModel: {
      attachmentCount: 0,
      attachments: [],
      conflictCount: 0,
      indexedPageCount: 0,
      noteCharacterCount:
        first.payload.markdown_body.length +
        second.payload.markdown_body.length,
      notes: [first, second],
      resourceCount: 0,
      resources: [],
      selectedNote: first,
    },
  };
  return { commands, controller };
}

describe("Records workbench", () => {
  it("removes the editor immediately when the Vault locks even before old data is cleared", () => {
    const { controller } = controllerFixture();
    const { rerender } = render(<RecordsWorkbench controller={controller} />);
    expect(screen.getByLabelText("Markdown 正文")).toBeTruthy();
    rerender(
      <RecordsWorkbench
        controller={{
          ...controller,
          context: { ...controller.context, unlocked: false },
        }}
      />,
    );
    expect(screen.queryByLabelText("Markdown 正文")).toBeNull();
  });

  it("confirms selected text, retains a failed draft and prevents repeated submission", async () => {
    const { controller, commands } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);
    const trigger = screen.getByRole("button", { name: "选段用于复习" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    const body = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(2, 6);
    fireEvent.select(body);
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "将笔记选段用于复习" });
    expect(
      (screen.getByLabelText("所选原文") as HTMLTextAreaElement).value,
    ).toBe("Raft");
    fireEvent.change(screen.getByLabelText("知识点标题"), {
      target: { value: "共识算法" },
    });
    commands.createFromSelection.mockRejectedValueOnce(
      new Error("暂时无法保存"),
    );
    fireEvent.click(screen.getByRole("button", { name: "创建知识点" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("知识点标题") as HTMLTextAreaElement).value,
    ).toBe("共识算法");
    let finish!: (value: boolean) => void;
    commands.createFromSelection.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "创建知识点" }));
    fireEvent.click(screen.getByRole("button", { name: "正在保存" }));
    expect(commands.createFromSelection).toHaveBeenCalledTimes(2);
    finish(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(commands.createFromSelection).toHaveBeenLastCalledWith(
      "note-1",
      expect.objectContaining({
        kind: "topic",
        excerpt: "Raft",
        title: "共识算法",
      }),
    );
  });

  it("requires an existing topic and answer before creating a quiz, and drops the sheet when locked", async () => {
    const { controller, commands } = controllerFixture();
    const view = render(<RecordsWorkbench controller={controller} />);
    const body = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(2, 6);
    fireEvent.select(body);
    fireEvent.click(screen.getByRole("button", { name: "选段用于复习" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("创建类型"), {
      target: { value: "quiz_item" },
    });
    await screen.findByRole("option", { name: "共识" });
    expect(
      (
        screen.getByRole("button", {
          name: "创建题目",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("所属知识点"), {
      target: { value: "topic-1" },
    });
    fireEvent.change(screen.getByLabelText("参考答案"), {
      target: { value: "多数派" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建题目" }));
    await waitFor(() =>
      expect(commands.createFromSelection).toHaveBeenCalledWith(
        "note-1",
        expect.objectContaining({
          kind: "quiz_item",
          topicId: "topic-1",
          answer: "多数派",
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "选段用于复习" }));
    await screen.findByRole("dialog");
    view.rerender(
      <RecordsWorkbench
        controller={{
          ...controller,
          capabilities: { ...controller.capabilities, canCreate: false },
          context: { ...controller.context, unlocked: false },
        }}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("blocks queuing until capability succeeds and supports retry after failure", async () => {
    capabilityRequest.mockRejectedValueOnce(new Error("unavailable"));
    const { controller, commands } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    expect(
      (
        screen.getByRole("button", {
          name: "加入附件队列",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await screen.findByText(/无法确认服务端能力，当前不能加入队列/);
    capabilityRequest.mockResolvedValueOnce({ ingest_enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "重新检查上传能力" }));
    await screen.findByText(/服务端未启用附件上传，当前不能加入队列/);
    expect(commands.queueAttachment).not.toHaveBeenCalled();
    capabilityRequest.mockResolvedValueOnce({ ingest_enabled: true });
    fireEvent.click(screen.getByRole("button", { name: "重新检查上传能力" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "加入附件队列",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });
  it("requires explicit offline staging consent and makes no capability request", async () => {
    const { controller, commands } = controllerFixture();
    controller.context.online = false;
    render(<RecordsWorkbench controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    const submit = screen.getByRole("button", {
      name: "加入附件队列",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /仅在本地暂存/ }));
    expect(submit.disabled).toBe(false);
    expect(capabilityRequest).not.toHaveBeenCalled();
    expect(commands.queueAttachment).not.toHaveBeenCalled();
  });
  it("renders the GLM master, inline editor and inspector with one page primary", () => {
    const { controller } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);

    expect(screen.getByTestId("workbench-master")).toBeTruthy();
    expect(screen.getByTestId("records-editor")).toBeTruthy();
    expect(screen.getByTestId("workbench-inspector")).toBeTruthy();
    expect(screen.getByTestId("records-collections")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("moves note selection with Arrow keys", () => {
    const { commands, controller } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);
    const first = screen.getByRole("button", { name: /Raft 精读，更新于/ });
    const second = screen.getByRole("button", { name: /一致性模型，更新于/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(document.activeElement).toBe(second);
    expect(commands.selectNote).toHaveBeenLastCalledWith("note-2");
  });

  it("saves the selected object through the controller command", async () => {
    const { commands, controller } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);
    fireEvent.change(screen.getByRole("textbox", { name: "笔记标题" }), {
      target: { value: "Raft 精读修订" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
      target: { value: "# Raft\n\n新证据" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(commands.saveNote).toHaveBeenCalledWith("note-1", {
        markdownBody: "# Raft\n\n新证据",
        title: "Raft 精读修订",
      }),
    );
  });

  it("renders Markdown as safe structure without executable HTML", () => {
    const { controller } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);
    fireEvent.click(screen.getByRole("radio", { name: "安全预览" }));

    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/正文中的 HTML 不执行/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /https:\/\/example.com/ })
        .getAttribute("href"),
    ).toBe("https://example.com");
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("keeps resource registration and attachment queuing in secondary Sheets", async () => {
    const { controller } = controllerFixture();
    render(<RecordsWorkbench controller={controller} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /登记资料/ }), {
      code: "Enter",
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "HTTP(S) 链接" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "登记 HTTP(S) 链接" }),
    ).toBeTruthy();
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "登记 HTTP(S) 链接" }),
      {
        key: "Escape",
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    expect(
      await screen.findByRole("dialog", { name: "添加笔记附件" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("附件").getAttribute("accept")).toBe(
      "image/png,image/jpeg,text/plain",
    );
  });
});
