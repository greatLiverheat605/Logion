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

afterEach(cleanup);

beforeEach(() => {
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
    "# Raft\n\n<script>alert(1)</script>",
  );
  const second = note("note-2", "一致性模型", "# Consistency");
  const commands = {
    createNote: vi.fn(async () => "note-3"),
    createResource: vi.fn(async () => true),
    loadContext: vi.fn(async () => undefined),
    queueAttachment: vi.fn(async () => true),
    renameResource: vi.fn(async () => true),
    saveNote: vi.fn(async () => true),
    selectNote: vi.fn(),
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
