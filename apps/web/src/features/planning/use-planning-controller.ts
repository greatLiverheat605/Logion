"use client";
import { feedback } from "@/lib/feedback";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  canResumeSync,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "@logion/offline";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { WorkbenchOperationalContext } from "@/components/product/workbench";
import type {
  ProductOperationalState,
  ProductOperationalStateKind,
} from "@/components/product/product-workbench-state";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import {
  incompleteSyncMessage,
  matchesVaultSession,
  readWorkspaceSyncFacts,
  workspaceSyncStatus,
  type WorkspaceSyncFacts,
} from "@/features/sync/sync-diagnostics";
import { usePersona } from "@/features/personas/persona-context";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import {
  derivePlanningViewModel,
  type PlanningDerivedViewModel,
  type PlanningGoalRecord,
  type PlanningTaskRecord,
} from "./planning-workbench-model";

export type PlanningWorkspace = components["schemas"]["WorkspaceResponse"];
export type PlanningSpace = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];

type Phase = "error" | "idle" | "loading" | "ready";
type CommandPhase = "idle" | "pending" | "success";

interface PlanningPhasePayload extends JsonObject {
  acceptance_criteria: string[];
  description: string;
  estimated_minutes: number;
  id: string;
  position: number;
  title: string;
}

export interface PlanningGoalPayload extends JsonObject {
  description: string;
  desired_outcome: string;
  phases: PlanningPhasePayload[];
  plan_id: string;
  plan_version_id: string;
  space_id: string;
  target_date: string | null;
  title: string;
  weekly_minutes: number;
}

export interface PlanningTaskPayload extends JsonObject {
  estimated_minutes: number;
  goal_id: string;
  phase_id: string | null;
  space_id: string;
  status:
    | "backlog"
    | "blocked"
    | "cancelled"
    | "done"
    | "in_progress"
    | "planned"
    | "submitted"
    | "verified";
  title: string;
}

interface PlanningLocalView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

export interface PlanningCreateGoalInput {
  criterion: string;
  description: string;
  desiredOutcome: string;
  phaseMinutes: number;
  phaseTitle: string;
  targetDate: string;
  title: string;
  weeklyMinutes: number;
}

interface PlanningIdentifiers {
  goalId: string;
  phaseId: string;
  planId: string;
  planVersionId: string;
}

interface PlanningIssue {
  kind: "capability-disabled" | "conflict" | "error" | "permission";
  requestId?: string;
}

export const PLANNING_COMMAND_KEYS = [
  "createGoal",
  "loadContext",
  "selectGoal",
  "setSpaceId",
  "setWorkspaceId",
  "synchronize",
  "unlock",
] as const;

export function buildPlanningGoalPayload(
  input: PlanningCreateGoalInput,
  ids: PlanningIdentifiers,
  spaceId: string,
): PlanningGoalPayload {
  return {
    description: input.description,
    desired_outcome: input.desiredOutcome,
    phases: [
      {
        acceptance_criteria: [input.criterion],
        description: "",
        estimated_minutes: input.phaseMinutes,
        id: ids.phaseId,
        position: 0,
        title: input.phaseTitle,
      },
    ],
    plan_id: ids.planId,
    plan_version_id: ids.planVersionId,
    space_id: spaceId,
    target_date: input.targetDate || null,
    title: input.title,
    weekly_minutes: input.weeklyMinutes,
  };
}

export function shouldApplyPlanningResponse(
  requestId: number,
  currentRequestId: number,
  requestedWorkspace: string,
  currentWorkspace: string,
): boolean {
  return (
    requestId === currentRequestId && requestedWorkspace === currentWorkspace
  );
}

export function derivePlanningOperationalKind({
  commandPhase,
  conflictCount,
  contextPhase,
  dataPhase,
  deviceAvailable,
  hasContext,
  hasData,
  issueKind,
  online,
  stale,
  unlocked,
}: Readonly<{
  commandPhase: CommandPhase;
  conflictCount: number;
  contextPhase: Exclude<Phase, "idle">;
  dataPhase: Phase;
  deviceAvailable: boolean;
  hasContext: boolean;
  hasData: boolean;
  issueKind?: PlanningIssue["kind"];
  online: boolean;
  stale: boolean;
  unlocked: boolean;
}>): ProductOperationalStateKind | null {
  if (contextPhase === "error") return issueKind ?? "error";
  if (contextPhase === "loading") return "loading";
  if (!hasContext) return "empty";
  if (!deviceAvailable) return "capability-disabled";
  if (!unlocked) return "locked";
  if (dataPhase === "error") return issueKind ?? "error";
  if (issueKind && issueKind !== "error") return issueKind;
  if (!online) return "offline";
  if (dataPhase !== "ready") return "loading";
  if (conflictCount > 0) return "conflict";
  if (commandPhase === "pending") return "pending";
  if (issueKind === "error") return "error";
  if (stale) return "stale";
  if (commandPhase === "success") return "success";
  return hasData ? null : "empty";
}

function issueFrom(error: unknown): PlanningIssue {
  if (error instanceof LogionApiError) {
    const kind =
      error.status === 403 || error.status === 404
        ? "permission"
        : error.status === 409
          ? "conflict"
          : error.code.includes("CAPABILITY")
            ? "capability-disabled"
            : "error";
    return { kind, requestId: error.requestId };
  }
  return { kind: "error" };
}

function userMessage(error: unknown): string {
  return error instanceof LogionApiError
    ? `操作未完成（${error.code}，请求编号：${error.requestId}）。`
    : "操作未完成，已经确认的本地资料保持不变。";
}

function subscribeOnline(change: () => void): () => void {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function transport(workspaceId: string): SyncTransport {
  const call = (path: string, request: unknown, csrf = false) =>
    browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/${path}`, {
      body: JSON.stringify(request),
      csrf,
      method: "POST",
    });
  return {
    pull: (request) => call("pull", request),
    push: (request) => call("push", request, true),
  };
}

async function decrypt<T extends JsonObject>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<PlanningLocalView<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  const value =
    typeof reference === "string"
      ? await vault.get(reference, entity.workspace_id)
      : entity.payload;
  if (value === null) throw new Error("protected payload unavailable");
  return { entity, payload: value as T };
}

function goalRecord(
  view: PlanningLocalView<PlanningGoalPayload>,
): PlanningGoalRecord {
  return {
    id: view.entity.entity_id,
    payload: view.payload,
    syncStatus: view.entity.sync_status,
    updatedAt: view.entity.updated_at,
  };
}

function taskRecord(
  view: PlanningLocalView<PlanningTaskPayload>,
): PlanningTaskRecord {
  return {
    id: view.entity.entity_id,
    payload: view.payload,
    syncStatus: view.entity.sync_status,
    updatedAt: view.entity.updated_at,
  };
}

export interface PlanningControllerResult {
  capabilities: {
    canCreate: boolean;
    canSync: boolean;
    canUnlock: boolean;
    canWrite: boolean;
  };
  commands: {
    createGoal: (input: PlanningCreateGoalInput) => Promise<string | null>;
    loadContext: () => Promise<void>;
    selectGoal: (goalId: string | null) => void;
    reportDeletion: (message: string) => void;
    setSpaceId: (spaceId: string) => void;
    setWorkspaceId: (workspaceId: string) => void;
    synchronize: () => Promise<boolean>;
    recoverSnapshot: () => Promise<boolean>;
    unlock: (passphrase: string) => Promise<boolean>;
  };
  context: {
    online: boolean;
    operational: WorkbenchOperationalContext;
    operationalState: ProductOperationalState | null;
    spaceId: string;
    spaces: PlanningSpace[];
    status: string;
    unlocked: boolean;
    workspaceId: string;
    workspaces: PlanningWorkspace[];
  };
  viewModel: PlanningDerivedViewModel & { conflictCount: number };
}

export function usePlanningController(): PlanningControllerResult {
  const { state: session } = useSession();
  const {
    database,
    markChanged,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const { activePersona } = usePersona();
  const workspaceIdRef = useRef("");
  const syncContext = useRef(0);
  const unlockRequest = useRef(0);
  const deviceIdRef = useRef("");
  const contextRequest = useRef(0);
  const spaceRequest = useRef(0);
  const planningRequest = useRef(0);
  const unlocked = vaultPhase === "unlocked";
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    () => true,
  );

  const [workspaces, setWorkspaces] = useState<PlanningWorkspace[]>([]);
  const [spaces, setSpaces] = useState<PlanningSpace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState("");
  const [spaceId, setSpaceIdState] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>("");
  const [goals, setGoals] = useState<PlanningGoalRecord[]>([]);
  const [tasks, setTasks] = useState<PlanningTaskRecord[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [syncFacts, setSyncFacts] = useState<WorkspaceSyncFacts | null>(null);
  const [status, setStatus] = useState("正在准备目标与路线工作台……");
  const [contextPhase, setContextPhase] =
    useState<Exclude<Phase, "idle">>("loading");
  const [dataPhase, setDataPhase] = useState<Phase>("idle");
  const [commandPhase, setCommandPhase] = useState<CommandPhase>("idle");
  const [issue, setIssue] = useState<PlanningIssue | null>(null);

  const loadContext = useCallback(async () => {
    const requestId = ++contextRequest.current;
    setContextPhase("loading");
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: PlanningWorkspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      if (requestId !== contextRequest.current) return;
      const currentDevice = deviceResult.devices.find((item) => item.current);
      const nextWorkspace = workspaceResult.workspaces[0]?.id ?? "";
      const nextDevice = currentDevice?.id ?? "";
      if (
        nextWorkspace !== workspaceIdRef.current ||
        nextDevice !== deviceIdRef.current
      ) {
        syncContext.current += 1;
        unlockRequest.current += 1;
        setCommandPhase("idle");
        setSyncFacts(null);
      }
      workspaceIdRef.current = nextWorkspace;
      deviceIdRef.current = nextDevice;
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceIdState(nextWorkspace);
      setDeviceId(nextDevice);
      setIssue(null);
      setStatus(
        currentDevice
          ? "请选择 Space 并解锁本地资料。"
          : "当前浏览器没有可用设备，请先完成设备注册。",
      );
      setContextPhase("ready");
    } catch (error) {
      if (requestId !== contextRequest.current) return;
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setContextPhase("error");
    }
  }, []);

  useEffect(() => {
    if (session.status === "authenticated") {
      queueMicrotask(() => void loadContext());
    }
  }, [loadContext, session.status]);

  useEffect(() => {
    if (!workspaceId) return;
    const requestId = ++spaceRequest.current;
    const selectedWorkspace = workspaceId;
    queueMicrotask(() => {
      setContextPhase("loading");
      void browserApiClient
        .request<{ spaces: PlanningSpace[] }>(
          `/api/v1/workspaces/${selectedWorkspace}/spaces`,
        )
        .then((result) => {
          if (
            requestId !== spaceRequest.current ||
            selectedWorkspace !== workspaceIdRef.current
          ) {
            return;
          }
          setSpaces(result.spaces);
          setSpaceIdState(result.spaces[0]?.id ?? "");
          setIssue(null);
          setContextPhase("ready");
        })
        .catch((error: unknown) => {
          if (
            requestId !== spaceRequest.current ||
            selectedWorkspace !== workspaceIdRef.current
          ) {
            return;
          }
          setSpaces([]);
          setSpaceIdState("");
          setIssue(issueFrom(error));
          setStatus(userMessage(error));
          setContextPhase("error");
        });
    });
  }, [workspaceId]);

  const bootstrap = useCallback(
    async (
      db: LogionOfflineDatabase,
      localVault: OfflineVault,
      selectedWorkspace: string,
      selectedDevice: string,
      isCurrent: () => boolean,
      force = false,
    ) => {
      const current = await db.syncState.get(selectedWorkspace);
      if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
      if (!force && canResumeSync(current, selectedDevice)) {
        return;
      }
      const repository = new BootstrapRepository(db, {}, localVault);
      const fetchChunk = (
        snapshotId: string | null,
        chunkIndex: number | null,
      ) =>
        browserApiClient.request<unknown>(
          `/api/v1/workspaces/${selectedWorkspace}/sync/bootstrap`,
          {
            body: JSON.stringify({
              chunk_index: chunkIndex,
              device_id: selectedDevice,
              known_sync_epoch: current?.sync_epoch ?? null,
              message_type: "bootstrap_request",
              protocol_version: "sync-v1",
              snapshot_id: snapshotId,
              workspace_id: selectedWorkspace,
            }),
            method: "POST",
          },
        );
      const first = await fetchChunk(null, null);
      if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
      const validation = validateSyncV1Message(first);
      if (
        !validation.ok ||
        validation.value.message_type !== "bootstrap_response"
      ) {
        throw new Error("invalid bootstrap response");
      }
      const manifest = validation.value;
      if (
        force &&
        current?.sync_epoch &&
        manifest.sync_epoch !== current.sync_epoch
      )
        throw new Error("同步世代已变更，请在同步中心执行恢复。");
      await repository.prepareDeviceRebootstrap(first, {
        device_id: selectedDevice,
        workspace_id: selectedWorkspace,
      });
      if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
      await repository.stageChunk(first, {
        device_id: selectedDevice,
        workspace_id: selectedWorkspace,
      });
      for (let index = 1; index < manifest.chunk_count; index += 1) {
        if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
        const chunk = await fetchChunk(manifest.snapshot_id, index);
        if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
        await repository.stageChunk(chunk, {
          device_id: selectedDevice,
          workspace_id: selectedWorkspace,
        });
      }
      if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
      markChanged();
    },
    [markChanged],
  );

  const refresh = useCallback(
    async (
      db: LogionOfflineDatabase | null,
      localVault: OfflineVault | null,
      selectedWorkspace: string,
    ) => {
      if (
        db === null ||
        localVault === null ||
        !selectedWorkspace ||
        !matchesVaultSession(database, vault, db, localVault) ||
        selectedWorkspace !== workspaceIdRef.current
      )
        return;
      const requestId = ++planningRequest.current;
      setDataPhase("loading");
      try {
        const [goalRows, taskRows, openConflicts] = await Promise.all([
          db.entities
            .where("[workspace_id+entity_type]")
            .equals([selectedWorkspace, "learning_goal"])
            .toArray(),
          db.entities
            .where("[workspace_id+entity_type]")
            .equals([selectedWorkspace, "task"])
            .toArray(),
          readWorkspaceSyncFacts(db, selectedWorkspace),
        ]);
        const [nextGoals, nextTasks] = await Promise.all([
          Promise.all(
            goalRows
              .filter((item) => item.deleted_at === null)
              .map((item) => decrypt<PlanningGoalPayload>(localVault, item)),
          ),
          Promise.all(
            taskRows
              .filter((item) => item.deleted_at === null)
              .map((item) => decrypt<PlanningTaskPayload>(localVault, item)),
          ),
        ]);
        if (
          !matchesVaultSession(database, vault, db, localVault) ||
          !shouldApplyPlanningResponse(
            requestId,
            planningRequest.current,
            selectedWorkspace,
            workspaceIdRef.current,
          )
        ) {
          return;
        }
        setGoals(nextGoals.map(goalRecord));
        setTasks(nextTasks.map(taskRecord));
        setConflictCount(openConflicts.conflicts);
        setSyncFacts(openConflicts);
        setDataPhase("ready");
      } catch (error) {
        if (
          !matchesVaultSession(database, vault, db, localVault) ||
          !shouldApplyPlanningResponse(
            requestId,
            planningRequest.current,
            selectedWorkspace,
            workspaceIdRef.current,
          )
        ) {
          return;
        }
        setIssue(issueFrom(error));
        setStatus(userMessage(error));
        setDataPhase("error");
        throw error;
      }
    },
    [database, vault],
  );

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null) {
      syncContext.current += 1;
      planningRequest.current += 1;
      queueMicrotask(() => {
        setGoals([]);
        setTasks([]);
        setConflictCount(0);
        setSyncFacts(null);
        setDataPhase("idle");
        setCommandPhase("idle");
        setIssue(null);
      });
      return;
    }
    if (!workspaceId) return;
    queueMicrotask(() => {
      // Passive reloads must not replace a deletion rejection or queued status.
      void refresh(db, localVault, workspaceId)
        .then(() => {
          if (
            workspaceId === workspaceIdRef.current &&
            db === database.current &&
            localVault === vault.current
          ) {
            setStatus((current) =>
              current === "请选择 Space 并解锁本地资料。"
                ? "目标、阶段和关联任务已从本地加密资料读取。"
                : current,
            );
          }
        })
        .catch(() => undefined);
    });
  }, [database, refresh, unlocked, vault, vaultRevision, workspaceId]);

  const synchronizeCore = useCallback(
    async (reportFailure: boolean): Promise<boolean> => {
      const db = database.current;
      const localVault = vault.current;
      const selectedWorkspace = workspaceIdRef.current;
      const selectedDevice = deviceIdRef.current;
      const generation = syncContext.current;
      const current = () =>
        generation === syncContext.current &&
        db === database.current &&
        localVault === vault.current &&
        selectedWorkspace === workspaceIdRef.current &&
        selectedDevice === deviceIdRef.current;
      if (!db || !localVault || !selectedWorkspace || !selectedDevice)
        return false;
      try {
        await bootstrap(
          db,
          localVault,
          selectedWorkspace,
          selectedDevice,
          current,
        );
        if (!current()) return false;
        const result = await new SyncClient(
          db,
          transport(selectedWorkspace),
          localVault,
        ).synchronize(selectedWorkspace, selectedDevice);
        const remaining = await db.outbox
          .where("workspace_id")
          .equals(selectedWorkspace)
          .toArray();
        if (!current()) return false;
        const incomplete = incompleteSyncMessage(result, remaining);
        setIssue(incomplete ? { kind: "error" } : null);
        setStatus(incomplete ?? "目标与任务已同步。");
        return incomplete === null;
      } catch (error) {
        if (current() && reportFailure) {
          setIssue(issueFrom(error));
          setStatus(userMessage(error));
        }
        return false;
      } finally {
        if (current())
          await refresh(db, localVault, selectedWorkspace).catch(
            () => undefined,
          );
      }
    },
    [bootstrap, database, refresh, vault],
  );

  useEffect(() => {
    if (unlocked && online && workspaceId && deviceId) {
      queueMicrotask(() => void synchronizeCore(true));
    }
  }, [unlocked, online, workspaceId, deviceId, synchronizeCore]);

  function operationIsCurrent() {
    const generation = syncContext.current;
    const db = database.current;
    const localVault = vault.current;
    const selectedWorkspace = workspaceIdRef.current;
    const selectedDevice = deviceIdRef.current;
    return () =>
      generation === syncContext.current &&
      selectedWorkspace === workspaceIdRef.current &&
      selectedDevice === deviceIdRef.current &&
      matchesVaultSession(database, vault, db, localVault);
  }

  async function recoverSnapshot(): Promise<boolean> {
    const isCurrent = operationIsCurrent();
    const db = database.current,
      localVault = vault.current;
    const selectedWorkspace = workspaceIdRef.current,
      selectedDevice = deviceIdRef.current;
    if (!db || !localVault || !selectedWorkspace || !selectedDevice || !online)
      return false;
    setCommandPhase("pending");
    try {
      const pending = await db.outbox
        .where("workspace_id")
        .equals(selectedWorkspace)
        .count();
      const conflicts = await db.conflicts
        .where("[workspace_id+status]")
        .equals([selectedWorkspace, "open"])
        .count();
      if (pending || conflicts) {
        if (!isCurrent()) return false;
        setStatus(feedback.error("请先完成待同步操作并处理冲突，再补全资料。"));
        return false;
      }
      if (!isCurrent()) return false;
      await bootstrap(
        db,
        localVault,
        selectedWorkspace,
        selectedDevice,
        isCurrent,
        true,
      );
      await refresh(db, localVault, selectedWorkspace);
      if (!isCurrent()) return false;
      setStatus(feedback.success("已从服务器快照补全本地资料。"));
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setStatus(feedback.error(userMessage(error)));
      return false;
    } finally {
      if (isCurrent()) setCommandPhase("idle");
    }
  }

  async function synchronize(): Promise<boolean> {
    const generation = syncContext.current;
    setCommandPhase("pending");
    const synchronized = await synchronizeCore(true);
    if (generation === syncContext.current)
      setCommandPhase(synchronized ? "success" : "idle");
    return synchronized;
  }

  async function unlock(passphrase: string): Promise<boolean> {
    if (session.status !== "authenticated") return false;
    const selectedWorkspace = workspaceIdRef.current;
    const selectedDevice = deviceIdRef.current;
    const requestId = ++unlockRequest.current;
    const current = () =>
      requestId === unlockRequest.current &&
      selectedWorkspace === workspaceIdRef.current &&
      selectedDevice === deviceIdRef.current;
    let available: (() => boolean) | null = null;
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      available = () =>
        current() && matchesVaultSession(database, vault, db, localVault);
      if (!available()) return false;
      await refresh(db, localVault, selectedWorkspace);
      if (!available()) return false;
      setIssue(null);
      setStatus("本地资料已解锁；口令只保留在当前应用会话内存中。");
      return true;
    } catch (error) {
      if (!current() || (available !== null && !available())) return false;
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      return false;
    }
  }

  async function createGoal(
    input: PlanningCreateGoalInput,
  ): Promise<string | null> {
    const isCurrent = operationIsCurrent();
    const db = database.current;
    const localVault = vault.current;
    const selectedWorkspace = workspaceIdRef.current;
    const selectedSpace = spaceId;
    const selectedDevice = deviceIdRef.current;
    if (
      session.status !== "authenticated" ||
      !unlocked ||
      db === null ||
      localVault === null ||
      !selectedWorkspace ||
      !selectedSpace ||
      !selectedDevice
    ) {
      if (!isCurrent()) return null;
      setStatus("请先选择 Workspace 和 Space，并解锁本地资料。");
      return null;
    }
    const ids: PlanningIdentifiers = {
      goalId: crypto.randomUUID(),
      phaseId: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      planVersionId: crypto.randomUUID(),
    };
    const now = new Date().toISOString();
    setCommandPhase("pending");
    try {
      if (!isCurrent()) return null;
      await bootstrap(
        db,
        localVault,
        selectedWorkspace,
        selectedDevice,
        isCurrent,
      );
      if (!isCurrent()) return null;
      await new ProtectedOfflineRepository(db, localVault).commitMutation({
        base_version: 0,
        client_occurred_at: now,
        created_at: now,
        created_by: session.user.id,
        deleted_at: null,
        device_id: selectedDevice,
        entity_id: ids.goalId,
        entity_type: "learning_goal",
        local_revision: 1,
        operation_id: crypto.randomUUID(),
        operation_type: "create",
        payload: buildPlanningGoalPayload(input, ids, selectedSpace),
        protocol_version: "sync-v1",
        updated_at: now,
        updated_by: session.user.id,
        workspace_id: selectedWorkspace,
      });
      if (!isCurrent()) return null;
      const synchronized = await synchronizeCore(false);
      if (!isCurrent()) return null;
      setSelectedGoalId(ids.goalId);
      if (!isCurrent()) return null;
      setIssue(null);
      setCommandPhase("success");
      if (!isCurrent()) return null;
      setStatus(
        synchronized
          ? "目标与首个阶段已保存并同步。"
          : "目标与首个阶段已安全保存在本地，将在网络恢复后同步。",
      );
      return ids.goalId;
    } catch (error) {
      if (!isCurrent()) return null;
      setIssue(issueFrom(error));
      if (!isCurrent()) return null;
      setStatus(userMessage(error));
      if (isCurrent()) setCommandPhase("idle");
      await refresh(db, localVault, selectedWorkspace).catch(() => undefined);
      return null;
    }
  }

  function setWorkspaceId(nextWorkspaceId: string) {
    unlockRequest.current += 1;
    syncContext.current += 1;
    contextRequest.current += 1;
    spaceRequest.current += 1;
    planningRequest.current += 1;
    workspaceIdRef.current = nextWorkspaceId;
    setWorkspaceIdState(nextWorkspaceId);
    setSpaceIdState("");
    setSpaces([]);
    setGoals([]);
    setTasks([]);
    setConflictCount(0);
    setSelectedGoalId("");
    setDataPhase("idle");
    setSyncFacts(null);
    setCommandPhase("idle");
    setIssue(null);
  }

  function setSpaceId(nextSpaceId: string) {
    syncContext.current += 1;
    setSpaceIdState(nextSpaceId);
    setSelectedGoalId("");
    setCommandPhase("idle");
  }

  const viewModel = useMemo(
    () =>
      derivePlanningViewModel({
        goals: unlocked ? goals : [],
        selectedGoalId,
        spaceId,
        tasks: unlocked ? tasks : [],
      }),
    [goals, selectedGoalId, spaceId, tasks, unlocked],
  );
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const selectedSpace = spaces.find((item) => item.id === spaceId);
  const canWrite = !["reviewer", "viewer"].includes(
    selectedWorkspace?.role ?? "viewer",
  );
  const stale = [...viewModel.visibleGoals, ...viewModel.tasks].some(
    (item) => item.syncStatus !== "clean",
  );
  const operationalKind =
    derivePlanningOperationalKind({
      commandPhase,
      conflictCount,
      contextPhase,
      dataPhase,
      deviceAvailable: Boolean(deviceId),
      hasContext: Boolean(workspaceId && spaceId),
      hasData: viewModel.visibleGoals.length > 0,
      issueKind: issue?.kind,
      online,
      stale,
      unlocked,
    }) ?? (canWrite ? null : "permission");
  const recoveryByKind: Record<
    Exclude<ProductOperationalStateKind, "pending" | "permission" | "success">,
    ProductOperationalState["recovery"]
  > = {
    "capability-disabled": {
      href: "/app/security",
      kind: "link",
      label: "检查当前设备",
    },
    conflict: { href: "/app/sync", kind: "link", label: "处理同步冲突" },
    empty: { href: "#planning-new-goal", kind: "link", label: "新建目标" },
    error: {
      kind: "button",
      label: "重新读取",
      onInvoke: () => void loadContext(),
    },
    loading: {
      disabled: true,
      kind: "button",
      label: "正在读取",
      onInvoke: () => undefined,
    },
    locked: {
      href: "#planning-unlock",
      kind: "link",
      label: "解锁本地资料",
    },
    offline: { href: "/app/sync", kind: "link", label: "查看离线队列" },
    stale: {
      kind: "button",
      label: "立即同步",
      onInvoke: () => void synchronize(),
    },
  };
  const operationalState = operationalKind
    ? ({
        kind: operationalKind,
        recovery:
          operationalKind === "pending" || operationalKind === "success"
            ? { href: "/app/sync", kind: "link", label: "查看同步状态" }
            : operationalKind === "permission"
              ? {
                  href: "/app/workspaces",
                  kind: "link",
                  label: "查看成员权限",
                }
              : recoveryByKind[operationalKind],
        requestId: issue?.requestId,
      } as ProductOperationalState)
    : null;
  const operational: WorkbenchOperationalContext = {
    permission: selectedWorkspace
      ? {
          label: selectedWorkspace.role,
          tone: canWrite ? "good" : "warn",
        }
      : undefined,
    persona: activePersona
      ? { id: activePersona.id, name: activePersona.name }
      : undefined,
    space: selectedSpace
      ? { id: selectedSpace.id, name: selectedSpace.name }
      : undefined,
    sync: workspaceSyncStatus({
      facts: syncFacts,
      workspaceId,
      deviceId,
      unlocked,
      online,
      busy: commandPhase === "pending",
      loading: dataPhase === "loading",
      error: dataPhase === "error",
    }),
    vault: {
      label: unlocked ? "已解锁" : "已锁定",
      tone: unlocked ? "good" : "warn",
    },
    workspace: selectedWorkspace
      ? { id: selectedWorkspace.id, name: selectedWorkspace.name }
      : undefined,
  };

  return {
    capabilities: {
      canCreate: canWrite && unlocked && Boolean(spaceId && deviceId),
      canSync: unlocked && Boolean(workspaceId && deviceId),
      canUnlock: Boolean(workspaceId && deviceId),
      canWrite,
    },
    commands: {
      createGoal,
      recoverSnapshot,
      loadContext,
      selectGoal: setSelectedGoalId,
      reportDeletion: setStatus,
      setSpaceId,
      setWorkspaceId,
      synchronize,
      unlock,
    },
    context: {
      online,
      operational,
      operationalState,
      spaceId,
      spaces,
      status,
      unlocked,
      workspaceId,
      workspaces,
    },
    viewModel: { ...viewModel, conflictCount },
  };
}
