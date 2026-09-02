"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
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
    selectGoal: (goalId: string) => void;
    setSpaceId: (spaceId: string) => void;
    setWorkspaceId: (workspaceId: string) => void;
    synchronize: () => Promise<boolean>;
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
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const { activePersona } = usePersona();
  const workspaceIdRef = useRef("");
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
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [goals, setGoals] = useState<PlanningGoalRecord[]>([]);
  const [tasks, setTasks] = useState<PlanningTaskRecord[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
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
      workspaceIdRef.current = nextWorkspace;
      deviceIdRef.current = currentDevice?.id ?? "";
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceIdState(nextWorkspace);
      setDeviceId(currentDevice?.id ?? "");
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
    ) => {
      const current = await db.syncState.get(selectedWorkspace);
      if (
        current?.bootstrap_state === "ready" &&
        current.device_id === selectedDevice
      ) {
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
      const validation = validateSyncV1Message(first);
      if (
        !validation.ok ||
        validation.value.message_type !== "bootstrap_response"
      ) {
        throw new Error("invalid bootstrap response");
      }
      const manifest = validation.value;
      await repository.stageChunk(first, {
        device_id: selectedDevice,
        workspace_id: selectedWorkspace,
      });
      for (let index = 1; index < manifest.chunk_count; index += 1) {
        await repository.stageChunk(
          await fetchChunk(manifest.snapshot_id, index),
          {
            device_id: selectedDevice,
            workspace_id: selectedWorkspace,
          },
        );
      }
    },
    [],
  );

  const refresh = useCallback(
    async (
      db: LogionOfflineDatabase | null,
      localVault: OfflineVault | null,
      selectedWorkspace: string,
    ) => {
      if (db === null || localVault === null || !selectedWorkspace) return;
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
          db.conflicts
            .where("[workspace_id+status]")
            .equals([selectedWorkspace, "open"])
            .count(),
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
        setConflictCount(openConflicts);
        setDataPhase("ready");
      } catch (error) {
        if (
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
    [],
  );

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    queueMicrotask(() => {
      void refresh(db, localVault, workspaceId)
        .then(() => {
          if (workspaceId === workspaceIdRef.current) {
            setIssue(null);
            setStatus("目标、阶段和关联任务已从本地加密资料读取。");
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
      if (
        db === null ||
        localVault === null ||
        !selectedWorkspace ||
        !selectedDevice
      ) {
        return false;
      }
      try {
        await new SyncClient(
          db,
          transport(selectedWorkspace),
          localVault,
        ).synchronize(selectedWorkspace, selectedDevice);
        if (selectedWorkspace === workspaceIdRef.current) {
          setIssue(null);
          setStatus("目标与任务已同步。");
        }
        return true;
      } catch (error) {
        if (reportFailure && selectedWorkspace === workspaceIdRef.current) {
          setIssue(issueFrom(error));
          setStatus(userMessage(error));
        }
        return false;
      } finally {
        await refresh(db, localVault, selectedWorkspace).catch(() => undefined);
      }
    },
    [database, refresh, vault],
  );

  async function synchronize(): Promise<boolean> {
    setCommandPhase("pending");
    const synchronized = await synchronizeCore(true);
    setCommandPhase(synchronized ? "success" : "idle");
    return synchronized;
  }

  async function unlock(passphrase: string): Promise<boolean> {
    if (session.status !== "authenticated") return false;
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await refresh(db, localVault, workspaceIdRef.current);
      setIssue(null);
      setStatus("本地资料已解锁；口令只保留在当前应用会话内存中。");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      return false;
    }
  }

  async function createGoal(
    input: PlanningCreateGoalInput,
  ): Promise<string | null> {
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
      await bootstrap(db, localVault, selectedWorkspace, selectedDevice);
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
      const synchronized = await synchronizeCore(false);
      setSelectedGoalId(ids.goalId);
      setIssue(null);
      setCommandPhase("success");
      setStatus(
        synchronized
          ? "目标与首个阶段已保存并同步。"
          : "目标与首个阶段已安全保存在本地，将在网络恢复后同步。",
      );
      return ids.goalId;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(userMessage(error));
      setCommandPhase("idle");
      await refresh(db, localVault, selectedWorkspace).catch(() => undefined);
      return null;
    }
  }

  function setWorkspaceId(nextWorkspaceId: string) {
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
    setCommandPhase("idle");
    setIssue(null);
  }

  function setSpaceId(nextSpaceId: string) {
    setSpaceIdState(nextSpaceId);
    setSelectedGoalId("");
    setCommandPhase("idle");
  }

  const viewModel = useMemo(
    () =>
      derivePlanningViewModel({
        goals,
        selectedGoalId,
        spaceId,
        tasks,
      }),
    [goals, selectedGoalId, spaceId, tasks],
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
    sync: {
      label:
        conflictCount > 0
          ? `${conflictCount} 项冲突`
          : stale
            ? "待同步"
            : "已同步",
      tone: conflictCount > 0 || stale ? "warn" : "good",
    },
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
      loadContext,
      selectGoal: setSelectedGoalId,
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
