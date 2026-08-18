/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

import { LogionApiError } from "@/lib/api/client";

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

function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function apiError(status: number, code: string): LogionApiError {
  return new LogionApiError({
    code,
    message: "The workspace request failed.",
    requestId: `req-${status}`,
    retryable: status >= 500,
    status,
  });
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

describe("WorkspaceCenter member read boundary", () => {
  it("never requests members in the knowledge view", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) {
        return Promise.resolve({
          spaces: [space("workspace-a", "space-a", "知识空间")],
        });
      }
      if (path.endsWith("/members")) {
        return Promise.reject(new Error("Unexpected members request"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter view="knowledge" />);

    expect(await screen.findByText("知识空间")).toBeTruthy();
    const memberCalls = mockRequest.mock.calls.filter(
      ([path]) => typeof path === "string" && path.endsWith("/members"),
    );
    expect(memberCalls).toHaveLength(0);
    expect(screen.getByText("成员信息未读取")).toBeTruthy();
    expect(screen.getByText("— / 10")).toBeTruthy();
    expect(screen.queryByText("尚无成员记录")).toBeNull();
    expect(screen.queryByText("0 / 10")).toBeNull();
    expect(screen.queryByRole("button", { name: "发送邀请" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /受邀邮箱/ })).toBeNull();
    const invitationCalls = mockRequest.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/invitations"),
    );
    expect(invitationCalls).toHaveLength(0);
  });

  it("keeps authorized spaces when the members request is forbidden", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) {
        return Promise.resolve({
          spaces: [space("workspace-a", "space-a", "授权空间")],
        });
      }
      if (path.endsWith("/members")) {
        return Promise.reject(apiError(403, "WORKSPACE_MEMBERS_FORBIDDEN"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);

    expect(await screen.findByText("授权空间")).toBeTruthy();
    expect(await screen.findByText("成员列表不可见")).toBeTruthy();
    expect(
      screen.getByText(
        "当前账号没有查看成员列表的权限，成员信息不会在此显示。",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("工作区内容已更新；当前账号没有查看成员列表的权限。"),
    ).toBeTruthy();
  });

  it("does not expose member existence, count, or emails on a 403", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) {
        return Promise.resolve({ spaces: [] });
      }
      if (path.endsWith("/members")) {
        return Promise.reject(apiError(403, "WORKSPACE_MEMBERS_FORBIDDEN"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);

    expect(await screen.findByText("成员列表不可见")).toBeTruthy();
    expect(screen.queryByText("0 / 10")).toBeNull();
    expect(screen.queryByText("尚无成员记录")).toBeNull();
    expect(screen.queryByText(/example\.com/)).toBeNull();
    expect(screen.getByText("— / 10")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "发送邀请" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /受邀邮箱/ })).toBeNull();
    const invitationCalls = mockRequest.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/invitations"),
    );
    expect(invitationCalls).toHaveLength(0);
  });

  it("drops previous spaces and settles members independently when spaces fail", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [
            workspace("workspace-a", "工作区 A"),
            workspace("workspace-b", "工作区 B"),
          ],
        });
      }
      if (path === "/api/v1/workspaces/workspace-a/spaces") {
        return Promise.resolve({
          spaces: [space("workspace-a", "space-a", "A 空间")],
        });
      }
      if (path === "/api/v1/workspaces/workspace-a/members") {
        return Promise.resolve({ members: [] });
      }
      if (path === "/api/v1/workspaces/workspace-b/spaces") {
        return Promise.reject(apiError(503, "WORKSPACE_SPACES_UNAVAILABLE"));
      }
      if (path === "/api/v1/workspaces/workspace-b/members") {
        return Promise.resolve({
          members: [member("member-b", "b@example.com")],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);
    expect(await screen.findByText("A 空间")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /工作区 B/ }));

    expect(await screen.findByText("空间列表暂不可用")).toBeTruthy();
    expect(screen.queryByText("A 空间")).toBeNull();
    expect(screen.queryByText("当前工作区还没有空间")).toBeNull();
    expect(
      screen.getAllByText("服务暂时不可用，请稍后重试；现有数据未发生变化。")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("b@example.com")).toBeTruthy();
    expect(screen.getAllByText("1 / 10").length).toBeGreaterThan(0);
  });

  it("aborts in-flight detail requests when switching and on unmount", async () => {
    const signals = new Map<string, AbortSignal>();
    mockRequest.mockImplementation(
      (path: string, options?: { signal?: AbortSignal }) => {
        if (options?.signal) signals.set(path, options.signal);
        if (path === "/api/v1/workspaces") {
          return Promise.resolve({
            workspaces: [
              workspace("workspace-a", "工作区 A"),
              workspace("workspace-b", "工作区 B"),
            ],
          });
        }
        if (path === "/api/v1/workspaces/workspace-a/spaces") {
          return pending<{ spaces: Space[] }>();
        }
        if (path === "/api/v1/workspaces/workspace-a/members") {
          return pending<{ members: Member[] }>();
        }
        if (path === "/api/v1/workspaces/workspace-b/spaces") {
          return pending<{ spaces: Space[] }>();
        }
        if (path === "/api/v1/workspaces/workspace-b/members") {
          return pending<{ members: Member[] }>();
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );

    const { unmount } = render(<WorkspaceCenter />);
    await waitFor(() => {
      expect(signals.get("/api/v1/workspaces/workspace-a/spaces")).toBeTruthy();
      expect(
        signals.get("/api/v1/workspaces/workspace-a/members"),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /工作区 B/ }));

    await waitFor(() => {
      expect(
        signals.get("/api/v1/workspaces/workspace-a/spaces")?.aborted,
      ).toBe(true);
      expect(
        signals.get("/api/v1/workspaces/workspace-a/members")?.aborted,
      ).toBe(true);
    });
    await waitFor(() => {
      expect(signals.get("/api/v1/workspaces/workspace-b/spaces")).toBeTruthy();
    });

    unmount();

    expect(signals.get("/api/v1/workspaces/workspace-b/spaces")?.aborted).toBe(
      true,
    );
    expect(signals.get("/api/v1/workspaces/workspace-b/members")?.aborted).toBe(
      true,
    );
  });

  it("loads spaces and members together on the collaboration path", async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) {
        return Promise.resolve({
          spaces: [space("workspace-a", "space-a", "协作空间")],
        });
      }
      if (path.endsWith("/members")) {
        return Promise.resolve({
          members: [member("member-a", "collab@example.com")],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);

    expect(await screen.findByText("协作空间")).toBeTruthy();
    expect(await screen.findByText("collab@example.com")).toBeTruthy();
    expect(screen.getByText("工作区内容已更新。")).toBeTruthy();
    expect(screen.getAllByText("1 / 10").length).toBeGreaterThan(0);
  });

  it("hides the invite form until members are readable", async () => {
    const membersResult = deferred<{ members: Member[] }>();
    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [workspace("workspace-a", "工作区 A")],
        });
      }
      if (path.endsWith("/spaces")) {
        return Promise.resolve({
          spaces: [space("workspace-a", "space-a", "加载空间")],
        });
      }
      if (path.endsWith("/members")) {
        return membersResult.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<WorkspaceCenter />);

    await waitFor(() => {
      expect(
        mockRequest.mock.calls.some(
          ([path]) => typeof path === "string" && path.endsWith("/members"),
        ),
      ).toBe(true);
    });
    expect(screen.queryByRole("button", { name: "发送邀请" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /受邀邮箱/ })).toBeNull();

    await act(async () => {
      membersResult.resolve({
        members: [member("member-a", "ready@example.com")],
      });
      await membersResult.promise;
    });

    expect(await screen.findByText("加载空间")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "发送邀请" }),
    ).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /受邀邮箱/ })).toBeTruthy();
  });

  it("clears stale spaces and members when the selected workspace disappears", async () => {
    let listCalls = 0;
    mockRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        if (path === "/api/v1/workspaces") {
          if (options?.method === "POST") {
            return Promise.resolve(workspace("workspace-c", "工作区 C"));
          }
          listCalls += 1;
          return Promise.resolve({
            workspaces:
              listCalls === 1
                ? [workspace("workspace-a", "工作区 A")]
                : [workspace("workspace-c", "工作区 C")],
          });
        }
        if (path === "/api/v1/workspaces/workspace-a/spaces") {
          return Promise.resolve({
            spaces: [space("workspace-a", "space-a", "A 空间")],
          });
        }
        if (path === "/api/v1/workspaces/workspace-a/members") {
          return Promise.resolve({
            members: [member("member-a", "a@example.com")],
          });
        }
        if (path === "/api/v1/workspaces/workspace-c/spaces") {
          return Promise.reject(apiError(503, "WORKSPACE_SPACES_UNAVAILABLE"));
        }
        if (path === "/api/v1/workspaces/workspace-c/members") {
          return Promise.reject(apiError(403, "WORKSPACE_MEMBERS_FORBIDDEN"));
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );

    render(<WorkspaceCenter />);
    expect(await screen.findByText("A 空间")).toBeTruthy();
    expect(await screen.findByText("a@example.com")).toBeTruthy();
    expect(screen.getAllByText("1 / 10").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/工作区名称/), {
      target: { value: "工作区 C" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));

    expect(await screen.findByText("空间列表暂不可用")).toBeTruthy();
    expect(await screen.findByText("成员列表不可见")).toBeTruthy();
    expect(screen.queryByText("A 空间")).toBeNull();
    expect(screen.queryByText("a@example.com")).toBeNull();
    expect(screen.getByText("— / 10")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "发送邀请" })).toBeNull();
  });
});
