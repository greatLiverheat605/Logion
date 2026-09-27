/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkbenchProvider, useWorkbench } from "./provider";

const mocks = vi.hoisted(() => ({
  account: "owner",
  request: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/features/auth/session-provider", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    state: {
      status: "authenticated",
      user: { id: mocks.account, status: "active" },
    },
    refresh: vi.fn(),
  }),
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  workbenchRequest: mocks.request,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function Probe() {
  const { preferences } = useWorkbench();
  return <span data-testid="theme">{preferences["appearance.theme"]}</span>;
}
it("rebuilds the in-memory cache before a different account can render", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  mocks.account = "owner";
  let finishSecond!: (value: unknown) => void;
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/settings")) {
      if (mocks.account === "other")
        return new Promise((resolve) => {
          finishSecond = resolve;
        });
      return {
        settings: [{ key: "appearance.theme", value: '"dark"', version: 1 }],
      };
    }
    return { workspaces: [] };
  });
  const tree = (
    <WorkbenchProvider>
      <Probe />
    </WorkbenchProvider>
  );
  const view = render(tree);
  await waitFor(() =>
    expect(screen.getByTestId("theme").textContent).toBe("dark"),
  );
  mocks.account = "other";
  view.rerender(
    <WorkbenchProvider>
      <Probe />
    </WorkbenchProvider>,
  );
  expect(screen.queryByTestId("theme")).toBeNull();
  await waitFor(() => expect(finishSecond).toBeTypeOf("function"));
  finishSecond({ settings: [] });
  await waitFor(() =>
    expect(screen.getByTestId("theme").textContent).toBe("system"),
  );
  expect(
    mocks.request.mock.calls.filter(([path]) => path.endsWith("/settings")),
  ).toHaveLength(2);
});
