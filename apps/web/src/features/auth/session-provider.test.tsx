// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "./session-provider";
import type { SessionState } from "./session";

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  refresh: vi.fn(),
  authenticationRequired: null as (() => void) | null,
}));
vi.mock("@/lib/api/client", () => ({
  browserApiClient: {},
  subscribeAuthenticationRequired: (listener: () => void) => {
    mocks.authenticationRequired = listener;
    return () => {
      mocks.authenticationRequired = null;
    };
  },
}));
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  createAuthApi: vi.fn(),
  createWebLockRefreshCoordinator: vi.fn(),
  createSessionCoordinator: () => mocks,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe() {
  const { state, refresh } = useSession();
  return <button onClick={refresh}>{state.status}</button>;
}

it("preserves authenticated state during refresh, then applies logout", async () => {
  mocks.bootstrap.mockResolvedValue({
    status: "authenticated",
    sessionExpiresAt: null,
    user: { id: "user-1" },
  });
  let finish!: (state: SessionState) => void;
  mocks.refresh.mockImplementation(
    () =>
      new Promise<SessionState>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "authenticated" }));
  expect(screen.queryByText("loading")).toBeNull();
  finish({ status: "anonymous" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "anonymous" })).toBeTruthy(),
  );
});

it("rechecks a business authentication failure and removes its listener on unmount", async () => {
  mocks.bootstrap.mockResolvedValue({
    status: "authenticated",
    sessionExpiresAt: null,
    user: { id: "user-1" },
  });
  mocks.refresh.mockResolvedValue({ status: "anonymous" });
  const view = render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await screen.findByRole("button", { name: "authenticated" });
  await act(async () => {
    mocks.authenticationRequired?.();
  });
  expect(screen.getByRole("button", { name: "anonymous" })).toBeTruthy();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mocks.authenticationRequired).toBeNull();
});

it.each(["timer", "focus", "visibilitychange"])(
  "renews on %s when access is due",
  async (trigger) => {
    vi.useFakeTimers();
    const start = Date.parse("2026-09-20T00:00:00Z");
    vi.setSystemTime(start);
    mocks.bootstrap.mockResolvedValue({
      status: "authenticated",
      sessionExpiresAt: new Date(start + 15 * 60_000).toISOString(),
      user: { id: "user-1" },
    });
    mocks.refresh.mockResolvedValue({
      status: "authenticated",
      sessionExpiresAt: new Date(start + 30 * 60_000).toISOString(),
      user: { id: "user-1" },
    });
    await act(async () => {
      render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
    });
    if (trigger === "timer") {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14 * 60_000);
      });
    } else {
      // Move wall time without executing the background timer to model suspension.
      vi.setSystemTime(start + 16 * 60_000);
      await act(async () => {
        (trigger === "focus" ? window : document).dispatchEvent(
          new Event(trigger),
        );
      });
    }
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "authenticated" })).toBeTruthy();
  },
);

it("does not renew early when access expiry exceeds the browser timer range", async () => {
  vi.useFakeTimers();
  const start = Date.parse("2026-09-24T22:00:00Z");
  vi.setSystemTime(start);
  const expiresAt = start + 30 * 24 * 60 * 60_000;
  mocks.bootstrap.mockResolvedValue({
    status: "authenticated",
    sessionExpiresAt: new Date(expiresAt).toISOString(),
    user: { id: "user-1" },
  });
  mocks.refresh.mockResolvedValue({
    status: "authenticated",
    sessionExpiresAt: new Date(expiresAt + 15 * 60_000).toISOString(),
    user: { id: "user-1" },
  });
  await act(async () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25 * 24 * 60 * 60_000);
  });
  expect(mocks.refresh).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 24 * 60 * 60_000);
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
