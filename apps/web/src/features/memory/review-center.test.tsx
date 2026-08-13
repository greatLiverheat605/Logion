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
const closeInspector = vi.fn();
const openInspector = vi.fn();

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

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: {
      sessionExpiresAt: null,
      status: "authenticated",
      user: {
        created_at: "2026-08-12T00:00:00Z",
        email: "reviewer@example.com",
        email_verified_at: "2026-08-12T00:00:00Z",
        id: "user-1",
        status: "active",
      },
    },
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => ({
    database: { current: null },
    phase: "locked",
    revision: 0,
    unlock: vi.fn(),
    vault: { current: null },
  }),
}));

vi.mock("@/features/desk/command-feedback-context", () => ({
  useInspector: () => ({ closeInspector, openInspector }),
}));

vi.mock("@/features/desk/use-knowledge-graph", () => ({
  useKnowledgeGraph: () => ({
    data: null,
    error: null,
    meta: null,
    reload: vi.fn(),
    state: "empty",
  }),
}));

import { ReviewCenter } from "./review-center";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];

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
    role: "editor",
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

beforeEach(() => {
  closeInspector.mockReset();
  mockRequest.mockReset();
  openInspector.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewCenter context loading", () => {
  it("keeps the current workspace when an older Space request resolves late", async () => {
    const firstSpaces = deferred<{ spaces: Space[] }>();
    const workspaces = [
      workspace("workspace-a", "工作区 A"),
      workspace("workspace-b", "工作区 B"),
    ];

    mockRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({ workspaces });
      }
      if (path === "/api/v1/auth/devices") {
        return Promise.resolve({
          devices: [
            {
              current: true,
              first_seen_at: "2026-08-12T00:00:00Z",
              id: "device-1",
              last_seen_at: "2026-08-12T00:00:00Z",
              name: "浏览器",
              platform: "test",
              revoked_at: null,
            },
          ],
        });
      }
      if (path === "/api/v1/workspaces/workspace-a/spaces") {
        return firstSpaces.promise;
      }
      if (path === "/api/v1/workspaces/workspace-b/spaces") {
        return Promise.resolve({
          spaces: [space("workspace-b", "space-b", "B 空间")],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<ReviewCenter />);
    const workspaceSelect = await screen.findByLabelText("工作区");
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        "/api/v1/workspaces/workspace-a/spaces",
        expect.any(Object),
      ),
    );

    fireEvent.change(workspaceSelect, { target: { value: "workspace-b" } });
    expect(await screen.findByRole("option", { name: /B 空间/ })).toBeTruthy();

    await act(async () => {
      firstSpaces.resolve({
        spaces: [space("workspace-a", "space-a", "A 空间")],
      });
      await firstSpaces.promise;
    });

    expect((workspaceSelect as HTMLSelectElement).value).toBe("workspace-b");
    expect(screen.queryByRole("option", { name: /A 空间/ })).toBeNull();
    expect(screen.getByRole("option", { name: /B 空间/ })).toBeTruthy();
  });
});
