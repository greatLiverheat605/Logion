/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { validateSyncV1Message } from "@logion/contracts";
import { BootstrapRepository, SyncClient } from "@logion/offline";
import { afterEach, describe, expect, it, vi } from "vitest";

const planningMocks = vi.hoisted(() => ({
  request: vi.fn(),
  vaultSession: {} as Record<string, unknown>,
}));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user-1" } },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => planningMocks.vaultSession,
}));
vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({ activePersona: null }),
}));
vi.mock("@/lib/api/client", () => ({
  browserApiClient: {
    request: (...args: unknown[]) => planningMocks.request(...args),
  },
  LogionApiError: class extends Error {},
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import {
  buildPlanningGoalPayload,
  derivePlanningOperationalKind,
  PLANNING_COMMAND_KEYS,
  shouldApplyPlanningResponse,
  usePlanningController,
} from "./use-planning-controller";

it.each(["device", "roundtrip", "same"] as const)(
  "guards delayed Planning bootstrap across %s context",
  async (change) => {
    const workspace = "11111111-1111-4111-8111-111111111111";
    const deviceA = "22222222-2222-4222-8222-222222222222";
    const deviceB = "33333333-3333-4333-8333-333333333333";
    const snapshotId = "44444444-4444-4444-8444-444444444444";
    let currentDevice = deviceA;
    let bootstrapNextRead = false;
    let requestedBootstrap = false;
    let finish!: (value: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const collection = {
      where: () => ({
        equals: () => ({ toArray: async () => [], count: async () => 0 }),
      }),
    };
    const db = {
      entities: collection,
      attachmentQueue: collection,
      conflicts: collection,
      outbox: collection,
      syncState: {
        get: async () => {
          // Hold the explicit D1 operation; automatic cycles see the current device ready.
          if (bootstrapNextRead) {
            bootstrapNextRead = false;
            return undefined;
          }
          return {
            workspace_id: workspace,
            device_id: currentDevice,
            bootstrap_state: "ready",
            sync_epoch: workspace,
            outbox_isolated_at: null,
          };
        },
      },
    };
    const localVault = {};
    Object.assign(planningMocks.vaultSession, {
      database: { current: db },
      vault: { current: localVault },
      phase: "unlocked",
      revision: 1,
      markChanged: vi.fn(),
      unlock: vi.fn(),
    });
    planningMocks.request.mockReset();
    planningMocks.request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces")
        return { workspaces: [{ id: workspace, name: "A", role: "owner" }] };
      if (path === "/api/v1/auth/devices")
        return { devices: [{ id: currentDevice, current: true }] };
      if (path.endsWith("/spaces"))
        return {
          spaces: [{ id: "space-1", name: "Private", visibility: "private" }],
        };
      if (path.endsWith("/sync/bootstrap")) {
        requestedBootstrap = true;
        return delayed;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const prepare = vi
      .spyOn(BootstrapRepository.prototype, "prepareDeviceRebootstrap")
      .mockResolvedValue(undefined);
    const stage = vi
      .spyOn(BootstrapRepository.prototype, "stageChunk")
      .mockResolvedValue({
        workspace_id: workspace,
        snapshot_id: snapshotId,
        received_chunks: 1,
        chunk_count: 1,
        received_records: 0,
        complete: true,
      });
    const synchronize = vi
      .spyOn(SyncClient.prototype, "synchronize")
      .mockResolvedValue({
        pushed: 0,
        pulled: 0,
        has_more: false,
        control: null,
      });
    const { result } = renderHook(() => usePlanningController());
    await waitFor(() =>
      expect(synchronize).toHaveBeenCalledWith(workspace, deviceA),
    );
    await waitFor(() =>
      expect(result.current.context.operationalState?.kind).toBe("empty"),
    );
    let pending!: Promise<boolean>;
    act(() => {
      bootstrapNextRead = true;
      pending = result.current.commands.synchronize();
    });
    await waitFor(() => expect(requestedBootstrap).toBe(true));
    const nextDevices =
      change === "roundtrip"
        ? [deviceB, deviceA]
        : change === "device"
          ? [deviceB]
          : [deviceA];
    for (const nextDevice of nextDevices) {
      const changed = nextDevice !== currentDevice;
      const callsBefore = synchronize.mock.calls.length;
      currentDevice = nextDevice;
      await act(async () => {
        await result.current.commands.loadContext();
      });
      if (changed) {
        await waitFor(() =>
          expect(synchronize).toHaveBeenCalledTimes(callsBefore + 1),
        );
        expect(synchronize).toHaveBeenLastCalledWith(workspace, nextDevice);
      } else expect(synchronize).toHaveBeenCalledTimes(callsBefore);
    }
    act(() =>
      result.current.commands.reportDeletion("current device feedback"),
    );
    const callsBeforeLateResponse = synchronize.mock.calls.length;
    const currentKind = result.current.context.operationalState?.kind;
    if (change !== "same") expect(currentKind).not.toBe("pending");
    const response = {
      message_type: "bootstrap_response",
      protocol_version: "sync-v1",
      min_supported_version: "sync-v1",
      workspace_id: workspace,
      device_id: deviceA,
      sync_epoch: workspace,
      snapshot_schema_version: 1,
      snapshot_id: snapshotId,
      chunk_index: 0,
      chunk_count: 1,
      cursor: 0,
      snapshot_checksum: `sha256:${"0".repeat(64)}`,
      chunk_checksum: `sha256:${"0".repeat(64)}`,
      records: [],
      created_at: "2026-09-21T00:00:00Z",
    };
    expect(validateSyncV1Message(response).ok).toBe(true);
    await act(async () => {
      finish(response);
      expect(await pending).toBe(change === "same");
    });
    const accepted = change === "same" ? 1 : 0;
    expect(prepare).toHaveBeenCalledTimes(accepted);
    expect(stage).toHaveBeenCalledTimes(accepted);
    expect(synchronize).toHaveBeenCalledTimes(
      callsBeforeLateResponse + accepted,
    );
    if (change !== "same") {
      expect(result.current.context.status).toBe("current device feedback");
      expect(result.current.context.operationalState?.kind).toBe(currentKind);
    } else {
      expect(synchronize).toHaveBeenLastCalledWith(workspace, deviceA);
      expect(result.current.context.operationalState?.kind).toBe("success");
    }
  },
);

const ready = {
  commandPhase: "idle" as const,
  conflictCount: 0,
  contextPhase: "ready" as const,
  dataPhase: "ready" as const,
  deviceAvailable: true,
  hasContext: true,
  hasData: true,
  online: true,
  stale: false,
  unlocked: true,
};

describe("Planning controller contract", () => {
  it("keeps every formal Planning command reachable", () => {
    expect(PLANNING_COMMAND_KEYS).toEqual([
      "createGoal",
      "loadContext",
      "selectGoal",
      "setSpaceId",
      "setWorkspaceId",
      "synchronize",
      "unlock",
    ]);
  });

  it("preserves the protected learning-goal aggregate payload", () => {
    expect(
      buildPlanningGoalPayload(
        {
          criterion: "提交一份可检查成果",
          description: "背景",
          desiredOutcome: "完成成果",
          phaseMinutes: 600,
          phaseTitle: "首个阶段",
          targetDate: "",
          title: "系统学习",
          weeklyMinutes: 360,
        },
        {
          goalId: "goal-1",
          phaseId: "phase-1",
          planId: "plan-1",
          planVersionId: "version-1",
        },
        "space-1",
      ),
    ).toEqual({
      description: "背景",
      desired_outcome: "完成成果",
      phases: [
        {
          acceptance_criteria: ["提交一份可检查成果"],
          description: "",
          estimated_minutes: 600,
          id: "phase-1",
          position: 0,
          title: "首个阶段",
        },
      ],
      plan_id: "plan-1",
      plan_version_id: "version-1",
      space_id: "space-1",
      target_date: null,
      title: "系统学习",
      weekly_minutes: 360,
    });
  });

  it("does not apply stale Workspace responses", () => {
    expect(
      shouldApplyPlanningResponse(3, 3, "workspace-1", "workspace-1"),
    ).toBe(true);
    expect(
      shouldApplyPlanningResponse(2, 3, "workspace-1", "workspace-1"),
    ).toBe(false);
    expect(
      shouldApplyPlanningResponse(3, 3, "workspace-1", "workspace-2"),
    ).toBe(false);
  });

  it("maps the formal recovery states without displaying guessed data", () => {
    expect(
      derivePlanningOperationalKind({ ...ready, contextPhase: "loading" }),
    ).toBe("loading");
    expect(derivePlanningOperationalKind({ ...ready, unlocked: false })).toBe(
      "locked",
    );
    expect(derivePlanningOperationalKind({ ...ready, online: false })).toBe(
      "offline",
    );
    expect(derivePlanningOperationalKind({ ...ready, conflictCount: 1 })).toBe(
      "conflict",
    );
    expect(derivePlanningOperationalKind({ ...ready, stale: true })).toBe(
      "stale",
    );
    expect(
      derivePlanningOperationalKind({
        ...ready,
        deviceAvailable: false,
      }),
    ).toBe("capability-disabled");
    expect(derivePlanningOperationalKind(ready)).toBeNull();
  });
});
