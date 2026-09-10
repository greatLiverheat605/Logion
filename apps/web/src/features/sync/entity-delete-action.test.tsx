/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityDeleteAction } from "./entity-delete-action";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  commit: vi.fn(),
  sync: vi.fn(),
  getEntity: vi.fn(),
  getState: vi.fn(),
  getOutbox: vi.fn(),
  changed: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user" } },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => ({
    database: {
      current: {
        entities: { get: mocks.getEntity },
        syncState: { get: mocks.getState },
        outbox: { get: mocks.getOutbox },
      },
    },
    vault: { current: {} },
    markChanged: mocks.changed,
  }),
}));
vi.mock("@/lib/api/client", async (original) => ({
  ...(await original<typeof import("@/lib/api/client")>()),
  browserApiClient: { request: mocks.request },
}));
vi.mock("@logion/offline", () => ({
  ProtectedOfflineRepository: class {
    commitMutation = mocks.commit;
  },
  SyncClient: class {
    synchronize = mocks.sync;
  },
}));
vi.mock("@/lib/feedback", () => ({
  feedback: { success: mocks.success, error: mocks.error },
  feedbackErrorText: (_error: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({
    server_version: 2,
    can_delete: true,
    blockers: { evidence_count: 0, citation_count: 0 },
    impact: { deleted_note: 1 },
  });
  mocks.getEntity.mockResolvedValue({ server_version: 2, local_revision: 1 });
  mocks.getState.mockResolvedValue({ device_id: "device" });
  mocks.getOutbox.mockResolvedValue(undefined);
  mocks.commit.mockResolvedValue({ kind: "committed" });
  mocks.sync.mockResolvedValue({ has_more: false, control: null });
});
afterEach(cleanup);

function setup(entityType: "note" | "task" | "learning_goal" = "note") {
  const onDeleted = vi.fn();
  const onStatus = vi.fn();
  render(
    <EntityDeleteAction
      entityType={entityType}
      entityId="entity"
      workspaceId="workspace"
      onDeleted={onDeleted}
      onStatus={onStatus}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^删除/ }));
  return { onDeleted, onStatus };
}

describe("deletion confirmation", () => {
  it.each(["note", "task", "learning_goal"] as const)(
    "shows %s scope and focuses Cancel without writing",
    async (kind) => {
      setup(kind);
      await screen.findByText("1 个笔记");
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "取消" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(mocks.commit).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: /^删除/ }),
        ),
      );
    },
  );

  it.each(["evidence_count", "citation_count"])(
    "blocks confirmation before commit for %s",
    async (kind) => {
      mocks.request.mockResolvedValue({
        server_version: 2,
        can_delete: false,
        blockers: { [kind]: 3 },
        impact: { deleted_note: 1 },
      });
      setup();
      await screen.findByText(/3 条.*请先解除引用/);
      expect(
        screen
          .getByRole("button", { name: "确认删除" })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(mocks.commit).not.toHaveBeenCalled();
    },
  );

  it("closes after the local commit while server acknowledgement is still pending", async () => {
    let resolve!: (value: unknown) => void;
    mocks.sync.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const callbacks = setup();
    await screen.findByText("1 个笔记");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(callbacks.onDeleted).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {},
        operation_type: "delete",
        base_version: 2,
        deleted_at: expect.any(String),
      }),
    );
    expect(mocks.success).not.toHaveBeenCalledWith("删除已同步。");
    resolve({ has_more: false, control: null });
    await waitFor(() =>
      expect(callbacks.onStatus).toHaveBeenCalledWith("删除已同步。"),
    );
  });

  it.each(["conflict", "blocked", "offline", "incomplete"])(
    "does not claim successful sync for %s",
    async (failure) => {
      if (failure === "offline")
        mocks.sync.mockRejectedValue(new TypeError("network"));
      else if (failure === "incomplete")
        mocks.sync.mockResolvedValue({ has_more: true, control: null });
      else
        mocks.getOutbox.mockResolvedValue({
          outbox_state: failure,
          last_error_code: "SYNC_DELETE_BLOCKED_BY_REFERENCE",
        });
      const callbacks = setup();
      await screen.findByText("1 个笔记");
      fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
      await waitFor(() => expect(mocks.error).toHaveBeenCalled());
      expect(mocks.success).not.toHaveBeenCalledWith("删除已同步。");
      expect(callbacks.onStatus).toHaveBeenLastCalledWith(
        expect.stringMatching(/同步中心/),
      );
    },
  );

  it("fails closed if the preview cannot be loaded", async () => {
    mocks.request.mockRejectedValue(new TypeError("network"));
    setup();
    await screen.findByText(/无法核对删除范围/);
    expect(
      screen.getByRole("button", { name: "确认删除" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
