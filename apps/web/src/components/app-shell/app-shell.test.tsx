/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { announceNotificationWorkspace } from "@/features/engagement/notification-center-model";

const mocks = vi.hoisted(() => ({ request: vi.fn(), userId: "user-1" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/search" }));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: {
      status: "authenticated",
      user: { id: mocks.userId, email: "synthetic@example.com" },
    },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => ({ phase: "locked" }),
}));
vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({
    activePersona: null,
    isLoading: false,
    isRouteVisible: () => false,
  }),
}));
vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request: (...args: unknown[]) => mocks.request(...args) },
}));
vi.mock("./app-operational-tools", () => ({ AppOperationalTools: () => null }));
vi.mock("./theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/features/auth/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("./app-modal", () => ({
  AppModal: ({ children, title }: { children: ReactNode; title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
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
const workspaces = {
  workspaces: [
    { id: "a", name: "Workspace A", role: "owner" },
    { id: "b", name: "Workspace B", role: "owner" },
  ],
};
beforeEach(() => {
  mocks.userId = "user-1";
  mocks.request.mockReset();
});
afterEach(cleanup);

it.each([false, true])(
  "ignores an out-of-order workspace summary (old failure=%s)",
  async (fail) => {
    const old = deferred<unknown>();
    mocks.request.mockImplementation((path: string) =>
      path === "/api/v1/workspaces"
        ? Promise.resolve(workspaces)
        : path.includes("/a/")
          ? old.promise
          : Promise.resolve({ notifications: [] }),
    );
    render(
      <AppShell>
        <h1>Content</h1>
      </AppShell>,
    );
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/api/v1/workspaces/a/notifications",
      ),
    );
    act(() => announceNotificationWorkspace("b", "user-1"));
    await screen.findByText("Workspace B");
    await act(async () => {
      if (fail) old.reject(new Error("old failure"));
      else old.resolve({ notifications: [] });
    });
    expect(screen.queryByText("Workspace A")).toBeNull();
    expect(screen.getByText("Workspace B")).toBeTruthy();
    expect(screen.queryByText(/工作区读取失败/)).toBeNull();
  },
);

it("clears same-status account data and rejects old-account events or replies", async () => {
  const old = deferred<unknown>();
  mocks.request.mockImplementation((path: string) =>
    path === "/api/v1/workspaces" ? Promise.resolve(workspaces) : old.promise,
  );
  const view = render(<AppShell>Content</AppShell>);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/v1/workspaces/a/notifications",
    ),
  );
  mocks.userId = "user-2";
  mocks.request.mockImplementation(async (path: string) =>
    path === "/api/v1/workspaces"
      ? { workspaces: [workspaces.workspaces[1]] }
      : { notifications: [] },
  );
  view.rerender(<AppShell>Content</AppShell>);
  await screen.findByText("Workspace B");
  const count = mocks.request.mock.calls.length;
  act(() => announceNotificationWorkspace("a", "user-1"));
  await act(async () => old.resolve({ notifications: [] }));
  expect(mocks.request).toHaveBeenCalledTimes(count);
  expect(screen.getByText("Workspace B")).toBeTruthy();
});
