/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@logion/contracts";

const mockRequest = vi.fn();

vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request: (...args: unknown[]) => mockRequest(...args) },
  LogionApiError: class LogionApiError extends Error {
    readonly code: string;
    readonly requestId: string;
    readonly retryable: boolean;
    readonly status: number;
    constructor(input: {
      code: string;
      message: string;
      requestId?: string;
      retryable?: boolean;
      status: number;
    }) {
      super(input.message);
      this.name = "LogionApiError";
      this.code = input.code;
      this.requestId = input.requestId ?? "unavailable";
      this.retryable = input.retryable ?? false;
      this.status = input.status;
    }
  },
}));

import { WorkspaceCenter } from "./workspace-center";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Member = components["schemas"]["WorkspaceMemberResponse"];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function workspace(id: string, name: string): Workspace {
  return {
    created_at: "2026-08-12T00:00:00Z",
    id,
    membership_status: "active",
    name,
    role: "admin",
    status: "active",
    updated_at: "2026-08-12T00:00:00Z",
    version: 1,
  };
}

function space(workspaceId: string, id: string, name: string): Space {
  return {
    created_at: "2026-08-12T00:00:00Z",
    id,
    name,
    owner_user_id: null,
    status: "active",
    updated_at: "2026-08-12T00:00:00Z",
    version: 1,
    visibility: "shared",
    workspace_id: workspaceId,
  };
}

function member(id: string, email: string): Member {
  return {
    created_at: "2026-08-12T00:00:00Z",
    email,
    id,
    joined_at: "2026-08-12T00:00:00Z",
    revoked_at: null,
    role: "viewer",
    status: "active",
    updated_at: "2026-08-12T00:00:00Z",
    user_id: `${id}-user`,
    version: 1,
  };
}

beforeEach(() => {
  mockRequest.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceCenter request boundaries", () => {
  it("exposes workspace choices as a named semantic list", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [
            workspace("workspace-a", "工作区 A"),
            workspace("workspace-b", "工作区 B"),
          ],
        });
      }
      if (path.endsWith("/spaces")) return Promise.resolve({ spaces: [] });
      if (path.endsWith("/members")) return Promise.resolve({ members: [] });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);

    const list = await screen.findByRole("list", { name: "工作区列表" });
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(screen.getByRole("button", { name: /工作区 A/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /工作区 B/ })).toBeTruthy();
  });

  it("ignores stale detail responses after switching workspaces", async () => {
    const firstSpaces = deferred<{ spaces: Space[] }>();
    const firstMembers = deferred<{ members: Member[] }>();
    const workspaces = [
      workspace("workspace-a", "工作区 A"),
      workspace("workspace-b", "工作区 B"),
    ];

    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({ workspaces });
      }
      if (path === "/api/v1/workspaces/workspace-a/spaces") {
        return firstSpaces.promise;
      }
      if (path === "/api/v1/workspaces/workspace-a/members") {
        return firstMembers.promise;
      }
      if (path === "/api/v1/workspaces/workspace-b/spaces") {
        return Promise.resolve({
          spaces: [space("workspace-b", "space-b", "B 空间")],
        });
      }
      if (path === "/api/v1/workspaces/workspace-b/members") {
        return Promise.resolve({
          members: [member("member-b", "b@example.com")],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);
    fireEvent.click(await screen.findByRole("button", { name: /工作区 B/ }));

    expect(await screen.findByText("B 空间")).toBeTruthy();
    expect(await screen.findByText("b@example.com")).toBeTruthy();

    await act(async () => {
      firstSpaces.resolve({
        spaces: [space("workspace-a", "space-a", "A 空间")],
      });
      firstMembers.resolve({ members: [member("member-a", "a@example.com")] });
      await Promise.all([firstSpaces.promise, firstMembers.promise]);
    });

    expect(screen.queryByText("A 空间")).toBeNull();
    expect(screen.queryByText("a@example.com")).toBeNull();
    expect(screen.getByText("B 空间")).toBeTruthy();
  });

  it("rejects a tampered invitation role without sending a request", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) return Promise.resolve({ spaces: [] });
      if (path.endsWith("/members")) return Promise.resolve({ members: [] });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);
    await screen.findByText("当前工作区还没有空间");
    mockRequest.mockClear();

    fireEvent.change(screen.getByRole("textbox", { name: /受邀邮箱/ }), {
      target: { value: "person@example.com" },
    });
    const role = screen.getByLabelText("角色") as HTMLSelectElement;
    role.append(new Option("所有者", "owner"));
    fireEvent.change(role, { target: { value: "owner" } });
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));

    expect(await screen.findByText("请选择有效邀请角色。")).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("reports a successful invitation as queued for email delivery", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) return Promise.resolve({ spaces: [] });
      if (path.endsWith("/members")) return Promise.resolve({ members: [] });
      if (path.endsWith("/invitations")) {
        return Promise.resolve({
          id: "invitation-a",
          status: "pending",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const { container } = render(<WorkspaceCenter />);
    const submit = await screen.findByRole("button", { name: "发送邀请" });
    const email = container.querySelector<HTMLInputElement>("#invite-email");
    const role = container.querySelector<HTMLSelectElement>("#invite-role");
    expect(email).not.toBeNull();
    expect(role).not.toBeNull();

    fireEvent.change(email!, { target: { value: "person@example.com" } });
    fireEvent.change(role!, { target: { value: "viewer" } });
    fireEvent.click(submit);

    expect(
      await screen.findByText("邀请邮件已进入发送队列，通常会在几分钟内送达。"),
    ).toBeTruthy();
    expect(mockRequest).toHaveBeenCalledWith(
      "/api/v1/workspaces/workspace-a/invitations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects a tampered member role without sending a request", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) return Promise.resolve({ spaces: [] });
      if (path.endsWith("/members")) {
        return Promise.resolve({
          members: [member("member-a", "a@example.com")],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);
    const role = (await screen.findByLabelText(
      "修改 a@example.com 的角色",
    )) as HTMLSelectElement;
    mockRequest.mockClear();

    role.append(new Option("所有者", "owner"));
    fireEvent.change(role, { target: { value: "owner" } });

    expect(await screen.findByText("请选择有效成员角色。")).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
