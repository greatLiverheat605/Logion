"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  OfflineVault,
  OfflineStorageError,
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
import { offlineCapabilityMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import {
  buildPersonaDashboard,
  type PersonaDashboardModel,
  PersonaDashboardRecord,
  type PersonaDashboardSource,
} from "@/features/personas/dashboard/persona-dashboard-model";
import type { BuiltinPersonaId } from "@/features/personas/persona-definitions";
import type { PersonaDashboardViewState } from "@/features/personas/persona-today-overview";
import { usePersona } from "@/features/personas/persona-context";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

export type TodayWorkspace = components["schemas"]["WorkspaceResponse"];
export type TodaySpace = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type Member = components["schemas"]["WorkspaceMemberResponse"];

const DASHBOARD_ENTITY_TYPES = [
  "exam",
  "exam_subject",
  "syllabus_node",
  "mock_exam",
  "score_record",
  "review_schedule",
  "mastery",
  "learning_goal",
  "learning_track",
  "study_project",
  "deliverable",
  "research_question",
  "paper_record",
  "research_claim",
  "experiment_run",
  "research_feedback",
  "rubric",
  "group_review",
  "group_feedback",
  "review_finding",
] as const;

export type TodayTaskStatus =
  | "backlog"
  | "blocked"
  | "cancelled"
  | "done"
  | "in_progress"
  | "planned"
  | "submitted"
  | "verified";

export interface TodayTaskPayload extends JsonObject {
  space_id: string;
  goal_id: string;
  phase_id: string | null;
  title: string;
  description: string;
  status: TodayTaskStatus;
  priority: number;
  estimated_minutes: number;
  planned_at: string | null;
  due_at: string | null;
  blocked_reason: string | null;
}

export interface TodaySessionPayload extends JsonObject {
  space_id: string;
  task_id: string;
  status: "active" | "completed" | "abandoned";
  started_at: string;
  ended_at: string | null;
  manual_minutes: number | null;
  reflection: string;
  outcome: "completed" | "abandoned" | null;
}

export interface TodayGoalPayload extends JsonObject {
  space_id: string;
  title: string;
  phases: { id: string; title: string }[];
}

export interface TodayEvidencePayload extends JsonObject {
  space_id: string;
  task_id: string;
  evidence_type: "text" | "link" | "note" | "resource";
  note_id: string | null;
  resource_id: string | null;
  summary: string;
  external_url: string | null;
}

export interface TodayVerificationPayload extends JsonObject {
  space_id: string;
  task_id: string;
  evidence_id: string;
  verdict: "pending" | "passed" | "failed" | "needs_revision";
  reviewer_notes: string;
  decided_by: string | null;
  decided_at: string | null;
}

export interface TodayContentReferencePayload extends JsonObject {
  space_id: string;
  title: string;
}

export interface TodayLocalView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

export interface TodayCreateTaskInput {
  description: string;
  estimatedMinutes: number;
  goalId: string;
  phaseId: string | null;
  priority: number;
  title: string;
}

export interface TodayFinishSessionInput {
  manualMinutes: number;
  outcome: "abandoned" | "completed";
  reflection: string;
}

export interface TodayEvidenceInput {
  evidenceType: "text" | "link" | "note" | "resource";
  externalUrl: string;
  referenceId: string;
  summary: string;
}

export interface TodayVerificationInput {
  reviewerNotes: string;
  verdict: "passed" | "failed" | "needs_revision";
}

export const TODAY_COMMAND_KEYS = [
  "closeVerifiedTask",
  "createTask",
  "decideVerification",
  "finishSession",
  "loadContext",
  "setSelectedTaskId",
  "setSpaceId",
  "setWorkspaceId",
  "startSession",
  "submitEvidence",
  "synchronize",
  "transitionTask",
  "unlock",
] as const;

const TODAY_TASK_STATUS_ORDER: Readonly<Record<TodayTaskStatus, number>> = {
  in_progress: 0,
  planned: 1,
  backlog: 2,
  blocked: 3,
  submitted: 4,
  verified: 5,
  done: 6,
  cancelled: 7,
};

interface TodayDerivedInput {
  evidence: TodayLocalView<TodayEvidencePayload>[];
  goals: TodayLocalView<TodayGoalPayload>[];
  selectedTaskId: string;
  sessions: TodayLocalView<TodaySessionPayload>[];
  spaceId: string;
  tasks: TodayLocalView<TodayTaskPayload>[];
  verifications: TodayLocalView<TodayVerificationPayload>[];
}

export interface TodayDerivedViewModel {
  actionableTasks: TodayLocalView<TodayTaskPayload>[];
  activeSession?: TodayLocalView<TodaySessionPayload>;
  blockedTaskCount: number;
  completedMinutes: number;
  completedTaskCount: number;
  completionRate: number;
  nextTask?: TodayLocalView<TodayTaskPayload>;
  pendingVerificationCount: number;
  queue: TodayLocalView<TodayTaskPayload>[];
  selectedTask?: TodayLocalView<TodayTaskPayload>;
  visibleEvidence: TodayLocalView<TodayEvidencePayload>[];
  visibleGoals: TodayLocalView<TodayGoalPayload>[];
  visibleSessions: TodayLocalView<TodaySessionPayload>[];
  visibleTasks: TodayLocalView<TodayTaskPayload>[];
  visibleVerifications: TodayLocalView<TodayVerificationPayload>[];
}

function compareTasks(
  left: TodayLocalView<TodayTaskPayload>,
  right: TodayLocalView<TodayTaskPayload>,
): number {
  const status =
    TODAY_TASK_STATUS_ORDER[left.payload.status] -
    TODAY_TASK_STATUS_ORDER[right.payload.status];
  if (status !== 0) return status;
  const priority = right.payload.priority - left.payload.priority;
  if (priority !== 0) return priority;
  return (left.payload.planned_at ?? left.entity.created_at).localeCompare(
    right.payload.planned_at ?? right.entity.created_at,
  );
}

export function deriveTodayViewModel({
  evidence,
  goals,
  selectedTaskId,
  sessions,
  spaceId,
  tasks,
  verifications,
}: TodayDerivedInput): TodayDerivedViewModel {
  const visibleGoals = goals.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleTasks = tasks.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const queue = [...visibleTasks].sort(compareTasks);
  const actionableTasks = queue.filter((item) =>
    ["backlog", "planned", "in_progress"].includes(item.payload.status),
  );
  const nextTask =
    actionableTasks.find((item) => item.payload.status === "in_progress") ??
    actionableTasks[0];
  const selectedTask =
    queue.find((item) => item.entity.entity_id === selectedTaskId) ??
    nextTask ??
    queue[0];
  const visibleEvidence = evidence.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleSessions = sessions.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleVerifications = verifications.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const completedTaskCount = visibleTasks.filter((item) =>
    ["done", "verified"].includes(item.payload.status),
  ).length;
  const completedMinutes = sessions
    .filter(
      (item) =>
        item.payload.space_id === spaceId &&
        item.payload.status === "completed",
    )
    .reduce((total, item) => total + (item.payload.manual_minutes ?? 0), 0);

  return {
    actionableTasks,
    activeSession: sessions.find(
      (item) =>
        item.payload.space_id === spaceId && item.payload.status === "active",
    ),
    blockedTaskCount: visibleTasks.filter(
      (item) => item.payload.status === "blocked",
    ).length,
    completedMinutes,
    completedTaskCount,
    completionRate: visibleTasks.length
      ? (completedTaskCount / visibleTasks.length) * 100
      : 0,
    nextTask,
    pendingVerificationCount: visibleVerifications.filter(
      (item) => item.payload.verdict === "pending",
    ).length,
    queue,
    selectedTask,
    visibleEvidence,
    visibleGoals,
    visibleSessions,
    visibleTasks,
    visibleVerifications,
  };
}

interface TodayOperationalInput {
  conflictCount: number;
  contextPhase: "error" | "loading" | "ready";
  dashboardPhase: "error" | "idle" | "loading" | "ready";
  deviceAvailable: boolean;
  hasContext: boolean;
  hasData: boolean;
  online: boolean;
  stale: boolean;
  unlocked: boolean;
}

export function deriveTodayOperationalKind({
  conflictCount,
  contextPhase,
  dashboardPhase,
  deviceAvailable,
  hasContext,
  hasData,
  online,
  stale,
  unlocked,
}: TodayOperationalInput): ProductOperationalStateKind | null {
  if (contextPhase === "error") return "error";
  if (contextPhase === "loading") return "loading";
  if (!hasContext) return "empty";
  if (!deviceAvailable) return "capability-disabled";
  if (!unlocked) return "locked";
  if (dashboardPhase === "error") return "error";
  if (dashboardPhase !== "ready") return "loading";
  if (conflictCount > 0) return "conflict";
  if (!online) return "offline";
  if (stale) return "stale";
  return hasData ? null : "empty";
}

function errorMessage(error: unknown): string {
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null) return capabilityMessage;
  if (error instanceof LogionApiError) {
    if (error.status === 403 || error.status === 404) {
      return `当前账号没有访问或修改该内容的权限（请求编号：${error.requestId}）。`;
    }
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  if (
    error instanceof OfflineStorageError &&
    error.code === "OFFLINE_INPUT_INVALID"
  ) {
    return "本地口令不正确，或输入不符合要求。";
  }
  if (error instanceof OfflineStorageError) {
    return `本地资料操作未完成（${error.code}）。`;
  }
  return "网络暂不可用，操作已保存在本设备，稍后可继续同步。";
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
  return {
    push: (request) =>
      browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/push`, {
        body: JSON.stringify(request),
        csrf: true,
        method: "POST",
      }),
    pull: (request) =>
      browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/pull`, {
        body: JSON.stringify(request),
        method: "POST",
      }),
  };
}

async function decrypted<T extends JsonObject>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<TodayLocalView<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  if (typeof reference !== "string") {
    return { entity, payload: entity.payload as T };
  }
  const payload = await vault.get(reference, entity.workspace_id);
  if (payload === null) throw new Error("protected payload unavailable");
  return { entity, payload: payload as T };
}

export interface TodayControllerResult {
  capabilities: {
    canSync: boolean;
    canUnlock: boolean;
    canWrite: boolean;
  };
  commands: {
    closeVerifiedTask: (
      verificationId: string,
      taskId: string,
    ) => Promise<boolean>;
    createTask: (input: TodayCreateTaskInput) => Promise<boolean>;
    decideVerification: (
      verificationId: string,
      input: TodayVerificationInput,
    ) => Promise<boolean>;
    finishSession: (input: TodayFinishSessionInput) => Promise<boolean>;
    loadContext: () => Promise<void>;
    setSelectedTaskId: (taskId: string) => void;
    setSpaceId: (spaceId: string) => void;
    setWorkspaceId: (workspaceId: string) => void;
    startSession: (taskId: string) => Promise<boolean>;
    submitEvidence: (
      taskId: string,
      input: TodayEvidenceInput,
    ) => Promise<boolean>;
    synchronize: () => Promise<void>;
    transitionTask: (
      taskId: string,
      next: TodayTaskStatus,
      blockedReason?: string,
    ) => Promise<boolean>;
    unlock: (passphrase: string) => Promise<boolean>;
  };
  context: {
    operational: WorkbenchOperationalContext;
    operationalState: ProductOperationalState | null;
    spaceId: string;
    spaces: TodaySpace[];
    status: string;
    unlocked: boolean;
    workspaceId: string;
    workspaces: TodayWorkspace[];
  };
  persona: {
    dashboardModel: PersonaDashboardModel | null;
    dashboardSource: PersonaDashboardSource;
    dashboardState: PersonaDashboardViewState;
  };
  references: {
    notes: TodayLocalView<TodayContentReferencePayload>[];
    resources: TodayLocalView<TodayContentReferencePayload>[];
  };
  selection: {
    taskId: string;
  };
  viewModel: TodayDerivedViewModel & {
    conflictCount: number;
  };
}

export function useTodayController(): TodayControllerResult {
  const { state: session } = useSession();
  const { activePersona } = usePersona();
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const [workspaces, setWorkspaces] = useState<TodayWorkspace[]>([]);
  const [spaces, setSpaces] = useState<TodaySpace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersAvailable, setMembersAvailable] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const unlocked = vaultPhase === "unlocked";
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    () => true,
  );
  const [status, setStatus] = useState("正在准备今日工作台……");
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dashboardPhase, setDashboardPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const [tasks, setTasks] = useState<TodayLocalView<TodayTaskPayload>[]>([]);
  const [sessions, setSessions] = useState<
    TodayLocalView<TodaySessionPayload>[]
  >([]);
  const [goals, setGoals] = useState<TodayLocalView<TodayGoalPayload>[]>([]);
  const [evidence, setEvidence] = useState<
    TodayLocalView<TodayEvidencePayload>[]
  >([]);
  const [verifications, setVerifications] = useState<
    TodayLocalView<TodayVerificationPayload>[]
  >([]);
  const [notes, setNotes] = useState<
    TodayLocalView<TodayContentReferencePayload>[]
  >([]);
  const [resources, setResources] = useState<
    TodayLocalView<TodayContentReferencePayload>[]
  >([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [dashboardRecords, setDashboardRecords] = useState<
    PersonaDashboardRecord[]
  >([]);
  const contextRequestRef = useRef<AbortController | null>(null);
  const spacesRequestRef = useRef<AbortController | null>(null);
  const dataRequestIdRef = useRef(0);
  const currentWorkspaceIdRef = useRef(workspaceId);

  const resetWorkspaceData = useCallback(() => {
    dataRequestIdRef.current += 1;
    setSpaces([]);
    setMembers([]);
    setMembersAvailable(false);
    setSpaceId("");
    setSelectedTaskId("");
    setTasks([]);
    setSessions([]);
    setGoals([]);
    setEvidence([]);
    setVerifications([]);
    setNotes([]);
    setResources([]);
    setConflictCount(0);
    setDashboardRecords([]);
    setDashboardPhase("idle");
  }, []);

  const selectWorkspace = useCallback(
    (nextWorkspaceId: string) => {
      if (nextWorkspaceId === currentWorkspaceIdRef.current) return;
      spacesRequestRef.current?.abort();
      currentWorkspaceIdRef.current = nextWorkspaceId;
      resetWorkspaceData();
      setContextPhase("loading");
      setWorkspaceId(nextWorkspaceId);
    },
    [resetWorkspaceData],
  );

  const loadContext = useCallback(async () => {
    contextRequestRef.current?.abort();
    const controller = new AbortController();
    contextRequestRef.current = controller;
    setContextPhase("loading");
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: TodayWorkspace[] }>(
          "/api/v1/workspaces",
          { signal: controller.signal },
        ),
        browserApiClient.request<{ devices: Device[] }>(
          "/api/v1/auth/devices",
          { signal: controller.signal },
        ),
      ]);
      if (
        controller.signal.aborted ||
        contextRequestRef.current !== controller
      ) {
        return;
      }
      const currentDevice = deviceResult.devices.find((item) => item.current);
      setWorkspaces(workspaceResult.workspaces);
      const nextWorkspaceId = workspaceResult.workspaces.some(
        (item) => item.id === currentWorkspaceIdRef.current,
      )
        ? currentWorkspaceIdRef.current
        : (workspaceResult.workspaces[0]?.id ?? "");
      if (nextWorkspaceId !== currentWorkspaceIdRef.current) {
        spacesRequestRef.current?.abort();
        resetWorkspaceData();
      }
      currentWorkspaceIdRef.current = nextWorkspaceId;
      setWorkspaceId(nextWorkspaceId);
      setDeviceId(currentDevice?.id ?? "");
      setStatus(currentDevice ? "请解锁本地资料。" : "未找到当前设备。");
      setContextPhase("ready");
    } catch (error) {
      if (
        controller.signal.aborted ||
        contextRequestRef.current !== controller
      ) {
        return;
      }
      setStatus(errorMessage(error));
      setContextPhase("error");
    } finally {
      if (contextRequestRef.current === controller) {
        contextRequestRef.current = null;
      }
    }
  }, [resetWorkspaceData]);

  const loadSpaces = useCallback(async (selectedWorkspace: string) => {
    spacesRequestRef.current?.abort();
    const controller = new AbortController();
    spacesRequestRef.current = controller;
    setContextPhase("loading");
    try {
      const [spaceResult, memberResult] = await Promise.all([
        browserApiClient.request<{ spaces: TodaySpace[] }>(
          `/api/v1/workspaces/${encodeURIComponent(selectedWorkspace)}/spaces`,
          { signal: controller.signal },
        ),
        browserApiClient
          .request<{
            members: Member[];
          }>(
            `/api/v1/workspaces/${encodeURIComponent(selectedWorkspace)}/members`,
            { signal: controller.signal },
          )
          .catch((error: unknown) => {
            if (error instanceof LogionApiError && error.status === 403) {
              return null;
            }
            throw error;
          }),
      ]);
      if (
        controller.signal.aborted ||
        spacesRequestRef.current !== controller ||
        currentWorkspaceIdRef.current !== selectedWorkspace
      ) {
        return;
      }
      setSpaces(spaceResult.spaces);
      setMembers(memberResult?.members ?? []);
      setMembersAvailable(memberResult !== null);
      setSpaceId((current) =>
        spaceResult.spaces.some((item) => item.id === current)
          ? current
          : (spaceResult.spaces[0]?.id ?? ""),
      );
      setContextPhase("ready");
    } catch (error) {
      if (
        controller.signal.aborted ||
        spacesRequestRef.current !== controller ||
        currentWorkspaceIdRef.current !== selectedWorkspace
      ) {
        return;
      }
      setSpaces([]);
      setMembers([]);
      setMembersAvailable(false);
      setSpaceId("");
      setStatus(errorMessage(error));
      setContextPhase("error");
    } finally {
      if (spacesRequestRef.current === controller) {
        spacesRequestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadContext();
    });
    return () => {
      active = false;
      contextRequestRef.current?.abort();
      dataRequestIdRef.current += 1;
    };
  }, [loadContext]);

  useEffect(() => {
    let active = true;
    if (workspaceId) {
      queueMicrotask(() => {
        if (active) void loadSpaces(workspaceId);
      });
    } else {
      spacesRequestRef.current?.abort();
    }
    return () => {
      active = false;
      spacesRequestRef.current?.abort();
    };
  }, [loadSpaces, workspaceId]);

  async function bootstrap(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
  ): Promise<void> {
    const current = await db.syncState.get(workspaceId);
    if (current?.bootstrap_state === "ready" && current.device_id === deviceId)
      return;
    const repository = new BootstrapRepository(db, {}, localVault);
    const first = await browserApiClient.request<unknown>(
      `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
      {
        body: JSON.stringify({
          chunk_index: null,
          device_id: deviceId,
          known_sync_epoch: current?.sync_epoch ?? null,
          message_type: "bootstrap_request",
          protocol_version: "sync-v1",
          snapshot_id: null,
          workspace_id: workspaceId,
        }),
        method: "POST",
      },
    );
    const validation = validateSyncV1Message(first);
    if (
      !validation.ok ||
      validation.value.message_type !== "bootstrap_response"
    ) {
      throw new Error("invalid bootstrap response");
    }
    const manifest = validation.value;
    await repository.stageChunk(first, {
      device_id: deviceId,
      workspace_id: workspaceId,
    });
    for (let index = 1; index < manifest.chunk_count; index += 1) {
      const chunk = await browserApiClient.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
        {
          body: JSON.stringify({
            chunk_index: index,
            device_id: deviceId,
            known_sync_epoch: manifest.sync_epoch,
            message_type: "bootstrap_request",
            protocol_version: "sync-v1",
            snapshot_id: manifest.snapshot_id,
            workspace_id: workspaceId,
          }),
          method: "POST",
        },
      );
      await repository.stageChunk(chunk, {
        device_id: deviceId,
        workspace_id: workspaceId,
      });
    }
  }

  async function refresh(
    db = database.current,
    localVault = vault.current,
  ): Promise<void> {
    const targetWorkspaceId = workspaceId;
    if (db === null || localVault === null || !targetWorkspaceId) return;
    const requestId = ++dataRequestIdRef.current;
    setDashboardPhase("loading");
    const entityRows = await Promise.all(
      [
        "task",
        "study_session",
        "learning_goal",
        "evidence",
        "verification",
        "note",
        "resource",
        ...DASHBOARD_ENTITY_TYPES,
      ].map((entityType) =>
        db.entities
          .where("[workspace_id+entity_type]")
          .equals([targetWorkspaceId, entityType])
          .toArray(),
      ),
    );
    const openConflicts = await db.conflicts
      .where("[workspace_id+status]")
      .equals([targetWorkspaceId, "open"])
      .count();
    const [
      taskRows = [],
      sessionRows = [],
      goalRows = [],
      evidenceRows = [],
      verificationRows = [],
      noteRows = [],
      resourceRows = [],
    ] = entityRows;
    const dashboardRows = entityRows.slice(7).flat();
    const [
      nextTasks,
      nextSessions,
      nextGoals,
      nextEvidence,
      nextVerifications,
      nextNotes,
      nextResources,
      nextDashboardViews,
    ] = await Promise.all([
      Promise.all(
        taskRows.map((item) => decrypted<TodayTaskPayload>(localVault, item)),
      ),
      Promise.all(
        sessionRows.map((item) =>
          decrypted<TodaySessionPayload>(localVault, item),
        ),
      ),
      Promise.all(
        goalRows.map((item) => decrypted<TodayGoalPayload>(localVault, item)),
      ),
      Promise.all(
        evidenceRows.map((item) =>
          decrypted<TodayEvidencePayload>(localVault, item),
        ),
      ),
      Promise.all(
        verificationRows.map((item) =>
          decrypted<TodayVerificationPayload>(localVault, item),
        ),
      ),
      Promise.all(
        noteRows.map((item) =>
          decrypted<TodayContentReferencePayload>(localVault, item),
        ),
      ),
      Promise.all(
        resourceRows.map((item) =>
          decrypted<TodayContentReferencePayload>(localVault, item),
        ),
      ),
      Promise.all(
        dashboardRows.map((item) => decrypted<JsonObject>(localVault, item)),
      ),
    ]);
    if (
      dataRequestIdRef.current !== requestId ||
      currentWorkspaceIdRef.current !== targetWorkspaceId
    ) {
      return;
    }
    setTasks(nextTasks);
    setSessions(nextSessions);
    setGoals(nextGoals);
    setEvidence(nextEvidence);
    setVerifications(nextVerifications);
    setNotes(nextNotes);
    setResources(nextResources);
    setConflictCount(openConflicts);
    setDashboardRecords(
      nextDashboardViews.flatMap(({ entity, payload }) => {
        const dashboardSpaceId = payload.space_id;
        return typeof dashboardSpaceId === "string"
          ? [
              {
                createdAt: entity.created_at,
                entityType: entity.entity_type,
                id: entity.entity_id,
                payload,
                spaceId: dashboardSpaceId,
                syncStatus: entity.sync_status,
                updatedAt: entity.updated_at,
              },
            ]
          : [];
      }),
    );
    setDashboardPhase("ready");
  }

  async function unlock(passphrase: string): Promise<boolean> {
    if (session.status !== "authenticated" || !workspaceId || !deviceId)
      return false;
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus(
        "本地资料已在应用内解锁；断网后仍可完整编辑。完成会话不会自动验收任务。",
      );
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      setDashboardPhase("error");
      return false;
    }
  }

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    const targetWorkspaceId = workspaceId;
    queueMicrotask(() => {
      void refresh(db, localVault)
        .then(() => {
          if (currentWorkspaceIdRef.current === targetWorkspaceId) {
            setStatus("本地资料已在应用内解锁；完成会话不会自动验收任务。");
          }
        })
        .catch((error: unknown) => {
          if (currentWorkspaceIdRef.current !== targetWorkspaceId) return;
          setDashboardPhase("error");
          setStatus(errorMessage(error));
        });
    });
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId]);

  async function synchronize(): Promise<void> {
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null || !workspaceId || !deviceId) return;
    try {
      await bootstrap(db, localVault);
      await new SyncClient(db, transport(workspaceId), localVault).synchronize(
        workspaceId,
        deviceId,
      );
      const remaining = await db.outbox
        .where("[workspace_id+device_id]")
        .equals([workspaceId, deviceId])
        .toArray();
      const blocked = remaining.filter(
        (item) => item.outbox_state === "blocked",
      ).length;
      const conflicts = remaining.filter(
        (item) => item.outbox_state === "conflict",
      ).length;
      const pending = remaining.length - blocked - conflicts;
      if (conflicts > 0) {
        setStatus(`有 ${conflicts} 项修改发生冲突，需要明确选择保留版本。`);
      } else if (blocked > 0) {
        setStatus(
          `有 ${blocked} 项修改因权限、版本或输入校验未同步，请检查同步中心。`,
        );
      } else if (pending > 0) {
        setStatus(`仍有 ${pending} 项本地修改等待网络恢复后同步。`);
      } else {
        setStatus("本地修改已与服务器同步。");
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      await refresh(db, localVault);
    }
  }

  async function commit(
    entityType: "evidence" | "study_session" | "task" | "verification",
    entityId: string,
    payload: JsonObject,
    existing?: LocalEntity,
    dependencies: string[] = [],
  ) {
    if (session.status !== "authenticated")
      throw new Error("not authenticated");
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) throw new Error("vault locked");
    const now = new Date().toISOString();
    return new ProtectedOfflineRepository(db, localVault).commitMutation({
      base_version: existing?.server_version ?? 0,
      client_occurred_at: now,
      created_at: existing?.created_at ?? now,
      created_by: existing?.created_by ?? session.user.id,
      deleted_at: null,
      device_id: deviceId,
      entity_id: entityId,
      entity_type: entityType,
      local_revision: (existing?.local_revision ?? 0) + 1,
      operation_id: crypto.randomUUID(),
      operation_type: existing === undefined ? "create" : "update",
      payload,
      protocol_version: "sync-v1",
      updated_at: now,
      updated_by: session.user.id,
      workspace_id: workspaceId,
      dependencies,
    });
  }

  async function createTask(input: TodayCreateTaskInput): Promise<boolean> {
    if (!unlocked || !spaceId) return false;
    if (!goals.some((item) => item.entity.entity_id === input.goalId)) {
      setStatus("请先在规划页创建目标并完成同步。");
      return false;
    }
    const now = new Date().toISOString();
    try {
      await commit("task", crypto.randomUUID(), {
        blocked_reason: null,
        description: input.description,
        due_at: null,
        estimated_minutes: input.estimatedMinutes,
        goal_id: input.goalId,
        phase_id: input.phaseId,
        planned_at: now,
        priority: input.priority,
        space_id: spaceId,
        status: "planned",
        title: input.title,
      });
      setStatus("任务已保存在本地；正在尝试同步。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function transitionTask(
    taskId: string,
    next: TodayTaskStatus,
    blockedReason = "",
  ): Promise<boolean> {
    const task = tasks.find((item) => item.entity.entity_id === taskId);
    if (!task || (next === "blocked" && !blockedReason.trim())) return false;
    try {
      await commit(
        "task",
        taskId,
        {
          ...task.payload,
          blocked_reason: next === "blocked" ? blockedReason.trim() : null,
          status: next,
        },
        task.entity,
      );
      setStatus("任务状态已在本地更新；正在尝试同步。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function startSession(taskId: string): Promise<boolean> {
    const task = tasks.find((item) => item.entity.entity_id === taskId);
    if (!task) return false;
    try {
      if (sessions.some((item) => item.payload.status === "active")) {
        setStatus("当前工作区已有进行中的会话，请先结束该会话。");
        return false;
      }
      if (task.payload.status === "backlog") {
        setStatus("请先将任务安排为计划中，再开始学习会话。");
        return false;
      }
      let current = task.entity;
      let dependencies: string[] = [];
      if (task.payload.status === "planned") {
        const transitioned = await commit(
          "task",
          taskId,
          { ...task.payload, blocked_reason: null, status: "in_progress" },
          task.entity,
        );
        current = transitioned.entity;
        dependencies = [transitioned.operation.operation_id];
      }
      const now = new Date().toISOString();
      await commit(
        "study_session",
        crypto.randomUUID(),
        {
          ended_at: null,
          manual_minutes: null,
          outcome: null,
          reflection: "",
          space_id: task.payload.space_id,
          started_at: now,
          status: "active",
          task_id: current.entity_id,
        },
        undefined,
        dependencies,
      );
      setStatus("学习会话已在本地开始。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function finishSession(
    input: TodayFinishSessionInput,
  ): Promise<boolean> {
    const active = sessions.find((item) => item.payload.status === "active");
    if (!active) return false;
    try {
      await commit(
        "study_session",
        active.entity.entity_id,
        {
          ...active.payload,
          ended_at: new Date().toISOString(),
          manual_minutes: input.manualMinutes,
          outcome: input.outcome,
          reflection: input.reflection,
          status: input.outcome,
        },
        active.entity,
      );
      setStatus("会话记录已保存；任务不会因此自动完成或通过验收。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function submitEvidence(
    taskId: string,
    input: TodayEvidenceInput,
  ): Promise<boolean> {
    const task = tasks.find((item) => item.entity.entity_id === taskId);
    if (!task) return false;
    const summary = input.summary.trim();
    const externalUrl = input.externalUrl.trim();
    if (input.evidenceType === "text" && !summary) {
      setStatus("文字证据需要填写内容。");
      return false;
    }
    if (input.evidenceType === "link" && !/^https?:\/\//i.test(externalUrl)) {
      setStatus("链接证据必须使用 HTTP 或 HTTPS 地址。");
      return false;
    }
    const availableReferences =
      input.evidenceType === "note" ? notes : resources;
    if (
      ["note", "resource"].includes(input.evidenceType) &&
      !availableReferences.some(
        (item) =>
          item.entity.entity_id === input.referenceId &&
          item.payload.space_id === task.payload.space_id,
      )
    ) {
      setStatus("请选择当前空间中已保存的笔记或资料。");
      return false;
    }
    try {
      let dependencies: string[] = [];
      if (task.payload.status === "in_progress") {
        const transition = await commit(
          "task",
          taskId,
          { ...task.payload, blocked_reason: null, status: "submitted" },
          task.entity,
        );
        dependencies = [transition.operation.operation_id];
      }
      await commit(
        "evidence",
        crypto.randomUUID(),
        {
          evidence_type: input.evidenceType,
          external_url: input.evidenceType === "link" ? externalUrl : null,
          note_id: input.evidenceType === "note" ? input.referenceId : null,
          resource_id:
            input.evidenceType === "resource" ? input.referenceId : null,
          space_id: task.payload.space_id,
          summary,
          task_id: taskId,
          verification_id: crypto.randomUUID(),
        },
        undefined,
        dependencies,
      );
      setStatus("证据和待验收状态已保存在本地；正在尝试同步。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function decideVerification(
    verificationId: string,
    input: TodayVerificationInput,
  ): Promise<boolean> {
    const verification = verifications.find(
      (item) => item.entity.entity_id === verificationId,
    );
    if (!verification) return false;
    try {
      await commit(
        "verification",
        verificationId,
        {
          ...verification.payload,
          action: "decide",
          reviewer_notes: input.reviewerNotes.trim(),
          verdict: input.verdict,
        },
        verification.entity,
      );
      setStatus("人工验收决定已保存在本地；正在尝试同步。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function closeVerifiedTask(
    verificationId: string,
    taskId: string,
  ): Promise<boolean> {
    const verification = verifications.find(
      (item) => item.entity.entity_id === verificationId,
    );
    const task = tasks.find((item) => item.entity.entity_id === taskId);
    if (!verification || !task) return false;
    try {
      await commit(
        "verification",
        verificationId,
        {
          ...verification.payload,
          action: "close_task",
          expected_task_version: task.entity.server_version,
        },
        verification.entity,
      );
      setStatus("关闭任务操作已保存在本地；正在尝试同步。");
      await synchronize();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  const viewModel = useMemo(
    () =>
      deriveTodayViewModel({
        evidence,
        goals,
        selectedTaskId,
        sessions,
        spaceId,
        tasks,
        verifications,
      }),
    [evidence, goals, selectedTaskId, sessions, spaceId, tasks, verifications],
  );

  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const selectedSpace = spaces.find((item) => item.id === spaceId);
  const canWrite = !["reviewer", "viewer"].includes(
    selectedWorkspace?.role ?? "viewer",
  );
  const hasPendingDashboardData =
    conflictCount > 0 ||
    dashboardRecords.some((record) => record.syncStatus !== "clean") ||
    [...tasks, ...sessions].some((item) => item.entity.sync_status !== "clean");
  const hasData =
    dashboardRecords.length + tasks.length + sessions.length + evidence.length >
    0;
  const operationalKind =
    deriveTodayOperationalKind({
      conflictCount,
      contextPhase,
      dashboardPhase,
      deviceAvailable: Boolean(deviceId),
      hasContext: Boolean(workspaceId && spaceId),
      hasData,
      online,
      stale: hasPendingDashboardData,
      unlocked,
    }) ?? (canWrite ? null : "permission");
  const recoveryByKind: Record<
    Exclude<ProductOperationalStateKind, "pending" | "success" | "permission">,
    ProductOperationalState["recovery"]
  > = {
    "capability-disabled": {
      href: "/app/security",
      kind: "link",
      label: "检查当前设备",
    },
    conflict: { href: "/app/sync", kind: "link", label: "处理同步冲突" },
    empty: {
      href: workspaceId && spaceId ? "/app/planning" : "/app/workspaces",
      kind: "link",
      label: workspaceId && spaceId ? "建立学习计划" : "选择工作区与 Space",
    },
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
    locked: { href: "#today-vault", kind: "link", label: "解锁本地资料" },
    offline: { href: "/offline", kind: "link", label: "查看离线能力" },
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
      } as ProductOperationalState)
    : null;
  const dashboardState: PersonaDashboardViewState =
    contextPhase === "error"
      ? "error"
      : contextPhase === "loading"
        ? "loading"
        : !workspaceId || !spaceId
          ? "needs-context"
          : !unlocked
            ? "locked"
            : dashboardPhase === "error"
              ? "error"
              : dashboardPhase !== "ready"
                ? "loading"
                : hasPendingDashboardData
                  ? "offline-stale"
                  : hasData
                    ? "ready"
                    : "empty";
  const dashboardSource: PersonaDashboardSource = {
    members: members.map((member) => ({
      id: member.id,
      status: member.status,
    })),
    membersAvailable,
    now: new Date(),
    records: dashboardRecords,
    selectedSpaceId: spaceId,
    sessions: sessions.map((item) => ({
      manualMinutes: item.payload.manual_minutes,
      spaceId: item.payload.space_id,
      startedAt: item.payload.started_at,
      status: item.payload.status,
    })),
    spaces: spaces.map((space) => ({
      id: space.id,
      visibility: space.visibility,
    })),
    tasks: tasks.map((item) => ({
      dueAt: item.payload.due_at,
      estimatedMinutes: item.payload.estimated_minutes,
      plannedAt: item.payload.planned_at,
      spaceId: item.payload.space_id,
      status: item.payload.status,
      title: item.payload.title,
    })),
  };
  const dashboardModel = activePersona?.isBuiltin
    ? buildPersonaDashboard(
        activePersona.id as BuiltinPersonaId,
        dashboardSource,
      )
    : null;
  const operational: WorkbenchOperationalContext = {
    permission: selectedWorkspace
      ? { label: selectedWorkspace.role, tone: canWrite ? "good" : "warn" }
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
          : hasPendingDashboardData
            ? "待同步"
            : "已同步",
      tone: conflictCount > 0 || hasPendingDashboardData ? "warn" : "good",
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
      canSync: unlocked && Boolean(deviceId),
      canUnlock:
        session.status === "authenticated" &&
        contextPhase === "ready" &&
        Boolean(workspaceId && deviceId),
      canWrite,
    },
    commands: {
      closeVerifiedTask,
      createTask,
      decideVerification,
      finishSession,
      loadContext,
      setSelectedTaskId,
      setSpaceId,
      setWorkspaceId: selectWorkspace,
      startSession,
      submitEvidence,
      synchronize,
      transitionTask,
      unlock,
    },
    context: {
      operational,
      operationalState,
      spaceId,
      spaces,
      status,
      unlocked,
      workspaceId,
      workspaces,
    },
    persona: { dashboardModel, dashboardSource, dashboardState },
    references: {
      notes: notes.filter((item) => item.payload.space_id === spaceId),
      resources: resources.filter((item) => item.payload.space_id === spaceId),
    },
    selection: {
      taskId: viewModel.selectedTask?.entity.entity_id ?? "",
    },
    viewModel: { ...viewModel, conflictCount },
  };
}
