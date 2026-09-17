// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  VAULT_SESSION_DURATION_MS,
  VaultSessionProvider,
  useVaultSession,
} from "./vault-session-provider";

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  close: vi.fn(),
  unlock: vi.fn(async () => {}),
  session: { status: "authenticated", user: { id: "user-1" } },
}));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({ state: mocks.session }),
}));
vi.mock("@logion/offline", () => ({
  databaseNameForUser: () => "test-vault",
  openOfflineDatabase: async () => ({
    close: mocks.close,
    vaultMetadata: { get: async () => ({}) },
  }),
  OfflineVault: class {
    unlock = mocks.unlock;
    lock = mocks.lock;
  },
}));
function Probe() {
  const session = useVaultSession();
  return (
    <>
      <button
        onClick={() =>
          void session.unlock("test-passphrase").catch(() => undefined)
        }
      >
        unlock
      </button>
      <button onClick={session.lock}>lock</button>
      <span>{session.phase}</span>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.unlock.mockResolvedValue(undefined);
  mocks.session.status = "authenticated";
});
it("keeps the same session through navigation and clears keys at the deadline", async () => {
  vi.useFakeTimers();
  const tree = render(
    <VaultSessionProvider>
      <Probe />
    </VaultSessionProvider>,
  );
  await act(async () => fireEvent.click(screen.getByText("unlock")));
  expect(screen.getByText("unlocked")).toBeTruthy();
  tree.rerender(
    <VaultSessionProvider>
      <Probe />
      <span>another route</span>
    </VaultSessionProvider>,
  );
  await act(async () =>
    vi.advanceTimersByTime(VAULT_SESSION_DURATION_MS - 1000),
  );
  expect(screen.getByText("unlocked")).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(screen.getByText("locked")).toBeTruthy();
  expect(mocks.lock).toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalled();
});
it("does not resurrect a key when logout occurs during unlock", async () => {
  let finish!: () => void;
  mocks.unlock.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const tree = render(
    <VaultSessionProvider>
      <Probe />
    </VaultSessionProvider>,
  );
  await act(async () => fireEvent.click(screen.getByText("unlock")));
  mocks.session = { ...mocks.session, status: "anonymous" };
  tree.rerender(
    <VaultSessionProvider>
      <Probe />
    </VaultSessionProvider>,
  );
  await act(async () => finish());
  expect(screen.getByText("locked")).toBeTruthy();
  expect(mocks.lock).toHaveBeenCalled();
});
