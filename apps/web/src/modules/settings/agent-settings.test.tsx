/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkbenchQueryClient } from "@/platform/workbench/api";
import { LogionApiError } from "@/lib/api/client";
import { AgentSettings } from "./agent-settings";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/platform/workbench/provider", () => ({
  useWorkbench: () => ({
    context: { workspace_id: "workspace", space_id: "space" },
  }),
}));
vi.mock("@/platform/workbench/api", async () => ({
  ...(await vi.importActual("@/platform/workbench/api")),
  workbenchRequest: mocks.request,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const token = {
  id: "token-id",
  workspace_id: "workspace",
  space_id: "space",
  name: "本机助手",
  scopes: ["read", "inbox:write"],
  created_at: "2026-09-01T00:00:00Z",
  expires_at: "2027-01-01T00:00:00Z",
  revoked_at: null,
};
const item = {
  id: "item-id",
  token_id: "token-id",
  agent_name: "本机助手",
  references: [],
  kind: "source",
  payload: { kind: "source", title: "原始投稿", doi: "10.1234/example" },
  status: "pending",
  version: 1,
  receipt: null,
  accepted_payload: null,
  created_at: "2026-09-01T00:00:00Z",
  decided_at: null,
};
function mount() {
  const client = createWorkbenchQueryClient();
  render(
    <QueryClientProvider client={client}>
      <AgentSettings />
    </QueryClientProvider>,
  );
  return client;
}
it("shows a disabled state without exposing controls or querying the inbox", async () => {
  mocks.request.mockRejectedValue(
    new LogionApiError({
      code: "NOT_FOUND",
      status: 404,
      message: "Not found",
    }),
  );
  mount();
  await screen.findByText(/当前服务器尚未启用/);
  expect(screen.queryByRole("button", { name: "创建令牌" })).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("keeps the one-time token out of query cache and clears its display", async () => {
  const secret = "synthetic-token-shown-once";
  mocks.request.mockImplementation(async (path, options) =>
    options?.method === "POST"
      ? { token: secret, detail: token }
      : path.endsWith("agent-tokens")
        ? { tokens: [], next_cursor: null }
        : { items: [], next_cursor: null },
  );
  const client = mount();
  await screen.findByRole("button", { name: "创建令牌" });
  fireEvent.change(screen.getByLabelText("令牌名称"), {
    target: { value: "本机助手" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
  await screen.findByLabelText("新令牌值");
  expect((screen.getByLabelText("新令牌值") as HTMLInputElement).value).toBe(
    secret,
  );
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain(secret);
  const call = mocks.request.mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    workspace_id: "workspace",
    space_id: "space",
    scopes: ["read", "inbox:write"],
  });
  fireEvent.click(screen.getByRole("button", { name: "已保存，关闭显示" }));
  expect(screen.queryByLabelText("新令牌值")).toBeNull();
});
it("retains edited proposals after rejection and submits only the explicit decision", async () => {
  mocks.request.mockImplementation(async (path, options) => {
    if (options?.method === "POST")
      throw new LogionApiError({
        code: "RESOURCE_VERSION_CONFLICT",
        status: 409,
        message: "changed",
      });
    return path.endsWith("agent-tokens")
      ? { tokens: [], next_cursor: null }
      : { items: [item], next_cursor: null };
  });
  mount();
  await screen.findByText("原始投稿");
  fireEvent.click(screen.getByRole("button", { name: "编辑后接受" }));
  fireEvent.change(screen.getByLabelText("文献标题"), {
    target: { value: "本人修订标题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "接受编辑后的内容" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("文献标题") as HTMLInputElement).value).toBe(
    "本人修订标题",
  );
  const call = mocks.request.mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(JSON.parse(call[1].body)).toEqual({
    expected_version: 1,
    decision: "accepted",
    payload: { ...item.payload, title: "本人修订标题" },
  });
  expect(
    mocks.request.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(1);
});
it("requires revocation confirmation and preserves recent-auth errors", async () => {
  mocks.request.mockImplementation(async (path, options) => {
    if (options?.method === "POST")
      throw new LogionApiError({
        code: "AUTH_RECENT_LOGIN_REQUIRED",
        status: 403,
        message: "recent auth",
      });
    return path.endsWith("agent-tokens")
      ? { tokens: [token], next_cursor: null }
      : { items: [], next_cursor: null };
  });
  mount();
  await screen.findByRole("button", { name: "撤销 本机助手" });
  fireEvent.click(screen.getByRole("button", { name: "撤销 本机助手" }));
  expect(
    mocks.request.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("重新登录");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("links accepted notes to the private editor and renders agent text as text", async () => {
  const content = "<script>UNTRUSTED-SENTINEL</script>";
  mocks.request.mockImplementation(async (path) =>
    path.endsWith("agent-tokens")
      ? { tokens: [], next_cursor: null }
      : {
          items: [
            {
              ...item,
              kind: "report",
              payload: {
                kind: "report",
                title: "研究报告",
                markdown_body: content,
              },
              status: "accepted",
              receipt: { entity_type: "note", id: "note-id" },
            },
          ],
          next_cursor: null,
        },
  );
  mount();
  await screen.findByRole("link", { name: "打开私人笔记" });
  expect(
    screen.getByRole("link", { name: "打开私人笔记" }).getAttribute("href"),
  ).toBe("/records?note=note-id&agent=1");
  expect(screen.getByText(content)).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "接受" })).toBeNull(),
  );
});
