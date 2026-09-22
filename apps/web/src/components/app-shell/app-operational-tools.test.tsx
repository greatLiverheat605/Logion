/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BootstrapRepository,
  ProtectedOfflineRepository,
  SyncClient,
} from "@logion/offline";
import * as contracts from "@logion/contracts";
import { AppOperationalTools } from "./app-operational-tools";
import { feedback } from "@/lib/feedback";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getState: vi.fn(),
  rows: vi.fn(),
  decrypt: vi.fn(),
  session: {} as Record<string, unknown>,
}));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user-1" } },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.session,
}));
vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request: (...args: unknown[]) => mocks.request(...args) },
  LogionApiError: class extends Error {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const ready = { bootstrap_state: "ready", device_id: "device-1" };
const database = {
  syncState: { get: (...args: unknown[]) => mocks.getState(...args) },
  entities: {
    where: () => ({
      equals: (key: string[]) => ({ toArray: () => mocks.rows(key) }),
    }),
  },
  outbox: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
};
const vault = { get: (...args: unknown[]) => mocks.decrypt(...args) };
function setVault(unlocked: boolean) {
  Object.assign(mocks.session, {
    phase: unlocked ? "unlocked" : "locked",
    activeDatabase: unlocked ? database : null,
    activeVault: unlocked ? vault : null,
  });
  (mocks.session.database as { current: unknown }).current = unlocked
    ? database
    : null;
  (mocks.session.vault as { current: unknown }).current = unlocked
    ? vault
    : null;
}

async function openCapture() {
  render(<AppOperationalTools />);
  fireEvent.click(screen.getByRole("button", { name: "打开快速捕获" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Space") as HTMLSelectElement).value).toBe(
      "a-space",
    ),
  );
  const title = screen.getByLabelText<HTMLInputElement>("标题");
  fireEvent.change(title, { target: { value: "synthetic capture" } });
  return title;
}
beforeEach(() => {
  mocks.request.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/v1/workspaces")
      return {
        workspaces: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      };
    if (path === "/api/v1/auth/devices")
      return { devices: [{ id: "device-1", current: true }] };
    if (path.endsWith("/spaces")) {
      const id = path.includes("/a/") ? "a" : "b";
      return {
        spaces: [
          { id: `${id}-space`, name: `${id} space`, visibility: "private" },
        ],
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  mocks.getState.mockReset().mockResolvedValue(ready);
  mocks.rows.mockReset().mockResolvedValue([]);
  mocks.decrypt.mockReset();
  Object.assign(mocks.session, {
    database: { current: null },
    vault: { current: null },
    revision: 1,
    markChanged: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
  });
  setVault(true);
  vi.spyOn(SyncClient.prototype, "synchronize").mockResolvedValue({
    pushed: 0,
    pulled: 0,
    has_more: false,
    control: null,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("continues capture only after a single confirmed local save and returns focus to the empty title", async () => {
  const pending = deferred<never>();
  const commit = vi
    .spyOn(ProtectedOfflineRepository.prototype, "commitMutation")
    .mockReturnValue(pending.promise);
  const title = await openCapture();
  const form = title.closest("form")!;
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  fireEvent.submit(form);
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(title.disabled).toBe(true);
  expect(title.value).toBe("synthetic capture");
  expect(screen.queryByText(/已加密保存并同步/)).toBeNull();
  await act(async () => pending.resolve(undefined as never));
  expect(
    await screen.findByText("学习收件箱内容已加密保存并同步。"),
  ).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(title));
  expect(title.value).toBe("");
  expect(screen.getByRole("dialog", { name: "快速捕获" })).toBeTruthy();
});

it("closes after a local save even when sync fails, preserves visible feedback and restores the trigger", async () => {
  vi.spyOn(
    ProtectedOfflineRepository.prototype,
    "commitMutation",
  ).mockResolvedValue(undefined as never);
  vi.mocked(SyncClient.prototype.synchronize).mockRejectedValueOnce(
    new Error("offline"),
  );
  const toast = vi
    .spyOn(feedback, "success")
    .mockImplementation((text) => text);
  await openCapture();
  fireEvent.click(screen.getByRole("button", { name: "保存并关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(toast).toHaveBeenCalledExactlyOnceWith(
    "学习收件箱内容已加密保存在本机；服务器同步暂未完成。",
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "打开快速捕获" }),
    ),
  );
});

it("keeps failed capture input and permits retry without claiming a saved record", async () => {
  const commit = vi
    .spyOn(ProtectedOfflineRepository.prototype, "commitMutation")
    .mockRejectedValueOnce(new Error("storage failed"));
  const title = await openCapture();
  fireEvent.click(screen.getByRole("button", { name: "保存并关闭" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(title.value).toBe("synthetic capture");
  expect(screen.getByRole("dialog", { name: "快速捕获" })).toBeTruthy();
  expect(screen.queryByText(/已加密保存/)).toBeNull();
  commit.mockResolvedValueOnce(undefined as never);
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  expect(
    await screen.findByText("学习收件箱内容已加密保存并同步。"),
  ).toBeTruthy();
  expect(commit).toHaveBeenCalledTimes(2);
});

it("discards late spaces from the previous workspace", async () => {
  const pending = deferred<{ spaces: { id: string; name: string }[] }>();
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string) =>
    path === "/api/v1/workspaces/a/spaces" ? pending.promise : request(path),
  );
  render(<AppOperationalTools />);
  fireEvent.click(screen.getByRole("button", { name: "打开快速捕获" }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith("/api/v1/workspaces/a/spaces"),
  );
  fireEvent.change(screen.getByLabelText("工作区"), { target: { value: "b" } });
  await waitFor(() =>
    expect((screen.getByLabelText("Space") as HTMLSelectElement).value).toBe(
      "b-space",
    ),
  );
  await act(async () =>
    pending.resolve({ spaces: [{ id: "old-space", name: "old space" }] }),
  );
  expect((screen.getByLabelText("Space") as HTMLSelectElement).value).toBe(
    "b-space",
  );
  expect(screen.queryByText("old space")).toBeNull();
});

it("does not commit a capture after locking during bootstrap", async () => {
  const tree = render(<AppOperationalTools />);
  fireEvent.click(screen.getByRole("button", { name: "打开快速捕获" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Space") as HTMLSelectElement).value).toBe(
      "a-space",
    ),
  );
  const pending = deferred<typeof ready>();
  mocks.getState.mockReturnValue(pending.promise);
  const commit = vi.spyOn(
    ProtectedOfflineRepository.prototype,
    "commitMutation",
  );
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "private draft" },
  });
  fireEvent.submit(screen.getByLabelText("标题").closest("form")!);
  await waitFor(() => expect(mocks.getState).toHaveBeenCalled());
  setVault(false);
  tree.rerender(<AppOperationalTools />);
  await act(async () => pending.resolve(ready));
  expect(commit).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue("private draft")).toBeNull();
  expect(screen.getByText("先解锁本地资料")).toBeTruthy();
});

it("discards delayed decrypted tasks after lock and only reads locally on revision", async () => {
  const pending = deferred<{
    title: string;
    status: string;
    space_id: string;
  }>();
  mocks.rows.mockImplementation(async ([, type]: string[]) =>
    type === "task"
      ? [
          {
            entity_id: "task-1",
            workspace_id: "a",
            payload: { encrypted_payload_ref: "secret" },
          },
        ]
      : [],
  );
  mocks.decrypt.mockReturnValue(pending.promise);
  const tree = render(<AppOperationalTools />);
  fireEvent.click(screen.getByRole("button", { name: "打开专注计时" }));
  await waitFor(() => expect(mocks.decrypt).toHaveBeenCalled());
  setVault(false);
  tree.rerender(<AppOperationalTools />);
  mocks.rows.mockResolvedValue([]);
  await act(async () =>
    pending.resolve({
      title: "old private task",
      status: "planned",
      space_id: "a-space",
    }),
  );
  setVault(true);
  tree.rerender(<AppOperationalTools />);
  await waitFor(() =>
    expect(screen.getByText(/当前空间没有计划中/)).toBeTruthy(),
  );
  const syncCount = vi.mocked(SyncClient.prototype.synchronize).mock.calls
    .length;
  const readCount = mocks.rows.mock.calls.length;
  mocks.session.revision = 2;
  tree.rerender(<AppOperationalTools />);
  await waitFor(() =>
    expect(mocks.rows.mock.calls.length).toBeGreaterThan(readCount),
  );
  expect(SyncClient.prototype.synchronize).toHaveBeenCalledTimes(syncCount);
  expect(screen.queryByText("old private task")).toBeNull();
});

it("never stages a late bootstrap response after locking and unlocking again", async () => {
  const tree = render(<AppOperationalTools />);
  fireEvent.click(screen.getByRole("button", { name: "打开快速捕获" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Space") as HTMLSelectElement).value).toBe(
      "a-space",
    ),
  );
  const pending = deferred<unknown>();
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string) =>
    path.endsWith("/bootstrap") ? pending.promise : request(path),
  );
  mocks.getState.mockResolvedValue(undefined);
  vi.spyOn(contracts, "validateSyncV1Message").mockReturnValue({
    ok: true,
    value: { message_type: "bootstrap_response", chunk_count: 1 },
  } as ReturnType<typeof contracts.validateSyncV1Message>);
  const prepare = vi
    .spyOn(BootstrapRepository.prototype, "prepareDeviceRebootstrap")
    .mockResolvedValue(undefined);
  const stage = vi.spyOn(BootstrapRepository.prototype, "stageChunk");
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "cancelled capture" },
  });
  fireEvent.submit(screen.getByLabelText("标题").closest("form")!);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/v1/workspaces/a/sync/bootstrap",
      expect.anything(),
    ),
  );
  setVault(false);
  tree.rerender(<AppOperationalTools />);
  setVault(true);
  tree.rerender(<AppOperationalTools />);
  await act(async () => pending.resolve({ snapshot: "old" }));
  expect(prepare).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
  expect(screen.queryByText(/已加密保存/)).toBeNull();
});
