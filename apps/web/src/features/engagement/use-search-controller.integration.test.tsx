/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useSearchController,
  type SearchNotification,
} from "./use-search-controller";
import { NOTIFICATION_CENTER_UPDATED_EVENT } from "./notification-center-model";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  userId: "user-1",
  workspaces: vi.fn(),
  feeds: vi.fn(),
}));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: mocks.userId } },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => ({
    database: { current: null },
    vault: { current: null },
    phase: "locked",
    revision: 0,
    unlock: vi.fn(),
  }),
}));
vi.mock("@/features/integrations/integration-capability-service", () => ({
  integrationCapabilityService: {
    listWorkspaces: () => mocks.workspaces(),
    listCalendarFeeds: () => mocks.feeds(),
    revokeCalendarFeed: async () => undefined,
    createCalendarFeed: async () => ({ token: "synthetic-once" }),
  },
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  browserApiClient: { request: (...args: unknown[]) => mocks.request(...args) },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const notification = (workspaceId: string): SearchNotification => ({
  id: `${workspaceId}-note`,
  workspace_id: workspaceId,
  category: "security",
  title: `${workspaceId} security`,
  summary: "A synthetic notification",
  read_at: null,
  created_at: "2026-09-01T00:00:00Z",
  target_id: null,
  target_type: null,
});
const preference = (workspaceId: string) => ({
  workspace_id: workspaceId,
  user_id: mocks.userId,
  enabled_categories: ["security", "billing", "sync"],
  version: 1,
  quiet_start_minute: null,
  quiet_end_minute: null,
  timezone: "UTC",
});
const preferenceInput = {
  enabledCategories: ["sync" as const],
  quietStartMinute: null,
  quietEndMinute: null,
  timezone: "Asia/Shanghai",
};
function standard(path: string) {
  const workspace = path.split("/")[4]!;
  if (path.endsWith("/notifications"))
    return { notifications: [notification(workspace)] };
  if (path.endsWith("/notification-preferences")) return preference(workspace);
  if (path.endsWith("/spaces")) return { spaces: [] };
  throw new Error(`Unexpected test path ${path}`);
}
beforeEach(() => {
  mocks.feeds.mockReset().mockResolvedValue([]);
  mocks.userId = "user-1";
  mocks.request
    .mockReset()
    .mockImplementation(async (path: string) => standard(path));
  mocks.workspaces.mockReset().mockResolvedValue([
    { id: "a", name: "A", role: "owner" },
    { id: "b", name: "B", role: "owner" },
  ]);
});

it.each(["read", "preferences"])(
  "keeps a concurrent calendar refresh after confirmed %s without undoing that confirmation",
  async (kind) => {
    const feed = {
      id: "feed-1",
      workspace_id: "a",
      name: "Calendar",
      status: "active" as const,
      version: 1,
      created_at: "2026-09-01T00:00:00Z",
    };
    mocks.feeds.mockResolvedValue([feed]);
    const hook = await ready();
    const mutation = deferred<unknown>();
    const refresh = deferred<unknown>();
    mocks.request.mockImplementation(
      (path: string, options?: { method?: string }) =>
        options?.method ? mutation.promise : Promise.resolve(standard(path)),
    );
    let write!: Promise<boolean>;
    act(() => {
      write =
        kind === "read"
          ? hook.result.current.commands.markRead(notification("a"))
          : hook.result.current.commands.savePreferences(preferenceInput);
    });
    mocks.feeds.mockReturnValue(refresh.promise);
    let revoked!: Promise<boolean>;
    act(() => {
      revoked = hook.result.current.commands.revokeFeed(feed);
    });
    await waitFor(() => expect(mocks.feeds).toHaveBeenCalledTimes(2));
    await act(async () => {
      mutation.resolve(
        kind === "read"
          ? { ...notification("a"), read_at: "2026-09-02T00:00:00Z" }
          : { ...preference("a"), version: 2 },
      );
      expect(await write).toBe(true);
    });
    await act(async () => {
      refresh.resolve([{ ...feed, status: "revoked", version: 2 }]);
      expect(await revoked).toBe(true);
    });
    expect(hook.result.current.utilities.feeds[0]?.status).toBe("revoked");
    if (kind === "read")
      expect(hook.result.current.utilities.unreadNotificationCount).toBe(0);
    else expect(hook.result.current.utilities.preference?.version).toBe(2);
  },
);
afterEach(cleanup);
async function ready() {
  const hook = renderHook(() => useSearchController("all"));
  await waitFor(() =>
    expect(hook.result.current.utilities.notifications[0]?.workspace_id).toBe(
      "a",
    ),
  );
  return hook;
}

it.each(["create", "revoke"])(
  "retains refresh errors after committed calendar %s without offering stale revoke",
  async (kind) => {
    const feed = {
      id: "feed-1",
      workspace_id: "a",
      name: "Calendar",
      status: "active" as const,
      version: 1,
      created_at: "2026-09-01T00:00:00Z",
    };
    mocks.feeds.mockResolvedValue([feed]);
    const hook = await ready();
    mocks.feeds.mockRejectedValue(new Error("refresh unavailable"));
    await act(async () => {
      if (kind === "create")
        expect(await hook.result.current.commands.createFeed("Calendar")).toBe(
          "synthetic-once",
        );
      else
        expect(await hook.result.current.commands.revokeFeed(feed)).toBe(true);
    });
    expect(hook.result.current.context.operationalState?.kind).toBe("error");
    expect(hook.result.current.context.status).toContain("列表尚未刷新");
    if (kind === "revoke")
      expect(hook.result.current.utilities.feeds[0]?.status).toBe("revoked");
  },
);

it.each(["read", "preferences"])(
  "ignores delayed %s mutation after A to B to A, without refreshing old scope",
  async (kind) => {
    const hook = await ready();
    const delayed = deferred<unknown>();
    mocks.request.mockImplementation(
      (path: string, options?: { method?: string }) =>
        options?.method ? delayed.promise : Promise.resolve(standard(path)),
    );
    const listener = vi.fn();
    window.addEventListener(NOTIFICATION_CENTER_UPDATED_EVENT, listener);
    try {
      let completion!: Promise<boolean>;
      act(() => {
        completion =
          kind === "read"
            ? hook.result.current.commands.markRead(notification("a"))
            : hook.result.current.commands.savePreferences(preferenceInput);
      });
      act(() => hook.result.current.commands.setWorkspaceId("b"));
      await waitFor(() =>
        expect(
          hook.result.current.utilities.notifications[0]?.workspace_id,
        ).toBe("b"),
      );
      act(() => hook.result.current.commands.setWorkspaceId("a"));
      await waitFor(() =>
        expect(
          hook.result.current.utilities.notifications[0]?.workspace_id,
        ).toBe("a"),
      );
      listener.mockClear();
      const count = mocks.request.mock.calls.length;
      await act(async () => {
        delayed.resolve(
          kind === "read"
            ? { ...notification("a"), read_at: "2026-09-02T00:00:00Z" }
            : preference("a"),
        );
        expect(await completion).toBe(false);
      });
      expect(mocks.request).toHaveBeenCalledTimes(count);
      expect(listener).not.toHaveBeenCalled();
      expect(hook.result.current.utilities.unreadNotificationCount).toBe(1);
      expect(hook.result.current.context.status).not.toMatch(
        /已保存|已标为已读/,
      );
    } finally {
      window.removeEventListener(NOTIFICATION_CENTER_UPDATED_EVENT, listener);
    }
  },
);

it("ignores a late failure after account replacement with the same authenticated status", async () => {
  const hook = await ready();
  const delayed = deferred<unknown>();
  mocks.request.mockImplementation(
    (path: string, options?: { method?: string }) =>
      options?.method ? delayed.promise : Promise.resolve(standard(path)),
  );
  let completion!: Promise<boolean>;
  act(() => {
    completion = hook.result.current.commands.markRead(notification("a"));
  });
  mocks.userId = "user-2";
  hook.rerender();
  await waitFor(() =>
    expect(hook.result.current.utilities.preference?.user_id).toBe("user-2"),
  );
  await act(async () => {
    delayed.reject(new Error("old-account-failure"));
    expect(await completion).toBe(false);
  });
  expect(hook.result.current.context.operationalState).toBeNull();
  expect(hook.result.current.context.status).not.toContain("操作未完成");
});

it("deduplicates pending reads, rejects another workspace, and applies only the server-confirmed read", async () => {
  const hook = await ready();
  const delayed = deferred<unknown>();
  mocks.request.mockImplementation(
    (path: string, options?: { method?: string }) =>
      options?.method ? delayed.promise : Promise.resolve(standard(path)),
  );
  let first!: Promise<boolean>;
  act(() => {
    first = hook.result.current.commands.markRead(notification("a"));
  });
  expect(await hook.result.current.commands.markRead(notification("a"))).toBe(
    false,
  );
  expect(await hook.result.current.commands.markRead(notification("b"))).toBe(
    false,
  );
  expect(hook.result.current.utilities.unreadNotificationCount).toBe(1);
  await act(async () => {
    delayed.resolve({ ...notification("a"), read_at: "2026-09-02T00:00:00Z" });
    expect(await first).toBe(true);
  });
  expect(hook.result.current.utilities.unreadNotificationCount).toBe(0);
  expect(
    mocks.request.mock.calls.filter(([, options]) => options?.method),
  ).toHaveLength(1);
});

it("preserves non-displayed billing and mandatory security when updating visible categories", async () => {
  const hook = await ready();
  mocks.request.mockImplementation(
    async (path: string, options?: { body?: string }) =>
      options?.body
        ? { ...preference("a"), ...JSON.parse(options.body), version: 2 }
        : standard(path),
  );
  await act(async () =>
    expect(
      await hook.result.current.commands.savePreferences(preferenceInput),
    ).toBe(true),
  );
  const body = JSON.parse(
    mocks.request.mock.calls.find(
      ([, options]) => options?.method === "PUT",
    )![1].body,
  );
  expect(body.enabled_categories.sort()).toEqual([
    "billing",
    "security",
    "sync",
  ]);
  expect(body.expected_version).toBe(1);
  expect(hook.result.current.utilities.preference?.version).toBe(2);
});

it("discards an old list after switching workspaces and on unmount", async () => {
  const delayed = deferred<unknown>();
  mocks.request.mockImplementation((path: string) =>
    path === "/api/v1/workspaces/a/notifications"
      ? delayed.promise
      : Promise.resolve(standard(path)),
  );
  const hook = renderHook(() => useSearchController("all"));
  await waitFor(() =>
    expect(hook.result.current.context.workspaceId).toBe("a"),
  );
  act(() => hook.result.current.commands.setWorkspaceId("b"));
  await waitFor(() =>
    expect(hook.result.current.utilities.notifications[0]?.workspace_id).toBe(
      "b",
    ),
  );
  await act(async () =>
    delayed.resolve({ notifications: [notification("a")] }),
  );
  expect(hook.result.current.utilities.notifications[0]?.workspace_id).toBe(
    "b",
  );
  hook.unmount();
});
