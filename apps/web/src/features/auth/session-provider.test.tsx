// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "./session-provider";
import type { SessionState } from "./session";

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), refresh: vi.fn() }));
vi.mock("./session", () => ({
  createAuthApi: vi.fn(),
  createWebLockRefreshCoordinator: vi.fn(),
  createSessionCoordinator: () => mocks,
  sessionRefreshDelay: () => null,
}));
afterEach(cleanup);

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
