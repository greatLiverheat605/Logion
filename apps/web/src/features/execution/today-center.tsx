"use client";

import Link from "next/link";
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
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ProductBarChart,
  ProductDisclosure,
  ProductEmptyState,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductProgress,
  ProductSignalGrid,
  ProductSignalList,
  ProductTag,
  ProductTaskRow,
  ProductWorkflowStage,
} from "@/components/product/product-ui";
import { useSession } from "@/features/auth/session-provider";
import { offlineUnlockMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import {
  type PersonaDashboardRecord,
  type PersonaDashboardSource,
} from "@/features/personas/dashboard/persona-dashboard-model";
import {
  PersonaTodayOverview,
  type PersonaDashboardViewState,
} from "@/features/personas/persona-today-overview";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
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

type TaskStatus =
  | "backlog"
  | "blocked"
  | "cancelled"
  | "done"
  | "in_progress"
  | "planned"
  | "submitted"
  | "verified";

interface TaskPayload extends JsonObject {
  space_id: string;
  goal_id: string;
  phase_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  estimated_minutes: number;
  planned_at: string | null;
  due_at: string | null;
  blocked_reason: string | null;
}

interface SessionPayload extends JsonObject {
  space_id: string;
  task_id: string;
  status: "active" | "completed" | "abandoned";
  started_at: string;
  ended_at: string | null;
  manual_minutes: number | null;
  reflection: string;
  outcome: "completed" | "abandoned" | null;
}

interface GoalPayload extends JsonObject {
  space_id: string;
  title: string;
  phases: { id: string; title: string }[];
}

interface EvidencePayload extends JsonObject {
  space_id: string;
  task_id: string;
  evidence_type: "text" | "link" | "note" | "resource";
  note_id: string | null;
  resource_id: string | null;
  summary: string;
  external_url: string | null;
}

interface VerificationPayload extends JsonObject {
  space_id: string;
  task_id: string;
  evidence_id: string;
  verdict: "pending" | "passed" | "failed" | "needs_revision";
  reviewer_notes: string;
  decided_by: string | null;
  decided_at: string | null;
}

interface ContentReferencePayload extends JsonObject {
  space_id: string;
  title: string;
}

interface LocalView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

function errorMessage(error: unknown): string {
  if (error instanceof LogionApiError) {
    if (error.status === 403 || error.status === 404) {
      return `当前账号没有访问或修改该内容的权限（请求编号：${error.requestId}）。`;
    }
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  return "网络暂不可用，操作已保存在本设备，稍后可继续同步。";
}

function transport(workspaceId: string): SyncTransport {
  return {
    push: (request) =>
      browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/push`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify(request),
      }),
    pull: (request) =>
      browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/pull`, {
        method: "POST",
        body: JSON.stringify(request),
      }),
  };
}

async function decrypted<T extends JsonObject>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<LocalView<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  if (typeof reference !== "string") {
    return { entity, payload: entity.payload as T };
  }
  const payload = await vault.get(reference, entity.workspace_id);
  if (payload === null) throw new Error("protected payload unavailable");
  return { entity, payload: payload as T };
}

export function TodayCenter() {
  const { state: session } = useSession();
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersAvailable, setMembersAvailable] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const unlocked = vaultPhase === "unlocked";
  const [status, setStatus] = useState("正在准备今日工作台……");
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dashboardPhase, setDashboardPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const [tasks, setTasks] = useState<LocalView<TaskPayload>[]>([]);
  const [sessions, setSessions] = useState<LocalView<SessionPayload>[]>([]);
  const [goals, setGoals] = useState<LocalView<GoalPayload>[]>([]);
  const [evidence, setEvidence] = useState<LocalView<EvidencePayload>[]>([]);
  const [verifications, setVerifications] = useState<
    LocalView<VerificationPayload>[]
  >([]);
  const [notes, setNotes] = useState<LocalView<ContentReferencePayload>[]>([]);
  const [resources, setResources] = useState<
    LocalView<ContentReferencePayload>[]
  >([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [dashboardRecords, setDashboardRecords] = useState<
    PersonaDashboardRecord[]
  >([]);

  const loadContext = useCallback(async () => {
    setContextPhase("loading");
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      const currentDevice = deviceResult.devices.find((item) => item.current);
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceId((current) =>
        workspaceResult.workspaces.some((item) => item.id === current)
          ? current
          : (workspaceResult.workspaces[0]?.id ?? ""),
      );
      setDeviceId(currentDevice?.id ?? "");
      setStatus(currentDevice ? "请解锁本地资料。" : "未找到当前设备。");
      setContextPhase("ready");
    } catch (error) {
      setStatus(errorMessage(error));
      setContextPhase("error");
    }
  }, []);

  const loadSpaces = useCallback(async (selectedWorkspace: string) => {
    try {
      const [spaceResult, memberResult] = await Promise.all([
        browserApiClient.request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${selectedWorkspace}/spaces`,
        ),
        browserApiClient
          .request<{
            members: Member[];
          }>(`/api/v1/workspaces/${selectedWorkspace}/members`)
          .catch((error: unknown) => {
            if (error instanceof LogionApiError && error.status === 403) {
              return null;
            }
            throw error;
          }),
      ]);
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
      setSpaces([]);
      setMembers([]);
      setMembersAvailable(false);
      setSpaceId("");
      setStatus(errorMessage(error));
      setContextPhase("error");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadContext());
  }, [loadContext]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadSpaces(workspaceId));
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
        method: "POST",
        body: JSON.stringify({
          message_type: "bootstrap_request",
          protocol_version: "sync-v1",
          workspace_id: workspaceId,
          device_id: deviceId,
          known_sync_epoch: current?.sync_epoch ?? null,
          snapshot_id: null,
          chunk_index: null,
        }),
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
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < manifest.chunk_count; index += 1) {
      const chunk = await browserApiClient.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
        {
          method: "POST",
          body: JSON.stringify({
            message_type: "bootstrap_request",
            protocol_version: "sync-v1",
            workspace_id: workspaceId,
            device_id: deviceId,
            known_sync_epoch: manifest.sync_epoch,
            snapshot_id: manifest.snapshot_id,
            chunk_index: index,
          }),
        },
      );
      await repository.stageChunk(chunk, {
        workspace_id: workspaceId,
        device_id: deviceId,
      });
    }
  }

  async function refresh(
    db = database.current,
    localVault = vault.current,
  ): Promise<void> {
    if (db === null || localVault === null || !workspaceId) return;
    setDashboardPhase("loading");
    const [
      taskRows,
      sessionRows,
      goalRows,
      evidenceRows,
      verificationRows,
      noteRows,
      resourceRows,
      openConflicts,
      dashboardRowsByType,
    ] = await Promise.all([
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "task"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "study_session"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "learning_goal"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "evidence"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "verification"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "note"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "resource"])
        .toArray(),
      db.conflicts
        .where("[workspace_id+status]")
        .equals([workspaceId, "open"])
        .count(),
      Promise.all(
        DASHBOARD_ENTITY_TYPES.map((entityType) =>
          db.entities
            .where("[workspace_id+entity_type]")
            .equals([workspaceId, entityType])
            .toArray(),
        ),
      ),
    ]);
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
        taskRows.map((item) => decrypted<TaskPayload>(localVault, item)),
      ),
      Promise.all(
        sessionRows.map((item) => decrypted<SessionPayload>(localVault, item)),
      ),
      Promise.all(
        goalRows.map((item) => decrypted<GoalPayload>(localVault, item)),
      ),
      Promise.all(
        evidenceRows.map((item) =>
          decrypted<EvidencePayload>(localVault, item),
        ),
      ),
      Promise.all(
        verificationRows.map((item) =>
          decrypted<VerificationPayload>(localVault, item),
        ),
      ),
      Promise.all(
        noteRows.map((item) =>
          decrypted<ContentReferencePayload>(localVault, item),
        ),
      ),
      Promise.all(
        resourceRows.map((item) =>
          decrypted<ContentReferencePayload>(localVault, item),
        ),
      ),
      Promise.all(
        dashboardRowsByType
          .flat()
          .map((item) => decrypted<JsonObject>(localVault, item)),
      ),
    ]);
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

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId) return;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus(
        "本地资料已在应用内解锁；断网后仍可完整编辑。完成会话不会自动验收任务。",
      );
      event.currentTarget.reset();
    } catch (error) {
      setStatus(offlineUnlockMessage(error) ?? errorMessage(error));
      setDashboardPhase("error");
    }
  }

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    queueMicrotask(
      () =>
        void refresh(db, localVault)
          .then(() =>
            setStatus("本地资料已在应用内解锁；完成会话不会自动验收任务。"),
          )
          .catch((error: unknown) => {
            setDashboardPhase("error");
            setStatus(errorMessage(error));
          }),
    );
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
      operation_id: crypto.randomUUID(),
      protocol_version: "sync-v1",
      workspace_id: workspaceId,
      device_id: deviceId,
      entity_type: entityType,
      entity_id: entityId,
      operation_type: existing === undefined ? "create" : "update",
      base_version: existing?.server_version ?? 0,
      local_revision: (existing?.local_revision ?? 0) + 1,
      client_occurred_at: now,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      created_by: existing?.created_by ?? session.user.id,
      updated_by: session.user.id,
      payload,
      dependencies,
    });
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked || !spaceId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const goalId = String(data.get("goal_id") ?? "");
    const selectedGoal = goals.find((item) => item.entity.entity_id === goalId);
    if (selectedGoal === undefined) {
      setStatus("请先在规划页创建目标并完成同步。");
      return;
    }
    const now = new Date().toISOString();
    const payload: TaskPayload = {
      space_id: spaceId,
      goal_id: goalId,
      phase_id: String(data.get("phase_id") || "") || null,
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      priority: Number(data.get("priority") ?? 2),
      estimated_minutes: Number(data.get("estimated_minutes") ?? 0),
      planned_at: now,
      due_at: null,
      status: "planned",
      blocked_reason: null,
    };
    try {
      await commit("task", crypto.randomUUID(), payload);
      form.reset();
      setStatus("任务已保存在本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function transitionTask(
    task: LocalView<TaskPayload>,
    next: TaskStatus,
  ) {
    try {
      const blockedReason =
        next === "blocked"
          ? (window.prompt("请输入阻塞原因")?.trim() ?? "")
          : null;
      if (next === "blocked" && !blockedReason) return;
      await commit(
        "task",
        task.entity.entity_id,
        { ...task.payload, status: next, blocked_reason: blockedReason },
        task.entity,
      );
      setStatus("任务状态已在本地更新；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function startSession(task: LocalView<TaskPayload>) {
    try {
      if (
        sessions.some((item) => (item.payload.status ?? "active") === "active")
      ) {
        setStatus("当前工作区已有进行中的会话，请先结束该会话。");
        return;
      }
      let current = task.entity;
      let dependency: string[] = [];
      const currentStatus = task.payload.status ?? "planned";
      if (currentStatus === "planned") {
        const transitioned = await commit(
          "task",
          task.entity.entity_id,
          { ...task.payload, status: "in_progress", blocked_reason: null },
          task.entity,
        );
        current = transitioned.entity;
        dependency = [transitioned.operation.operation_id];
      }
      if ((task.payload.status ?? "planned") === "backlog") {
        setStatus("请先将任务安排为计划中，再开始学习会话。");
        return;
      }
      const now = new Date().toISOString();
      await commit(
        "study_session",
        crypto.randomUUID(),
        {
          space_id: task.payload.space_id,
          task_id: current.entity_id,
          status: "active",
          started_at: now,
          ended_at: null,
          manual_minutes: null,
          reflection: "",
          outcome: null,
        },
        undefined,
        dependency,
      );
      setStatus("学习会话已在本地开始。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function finishSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const active = sessions.find(
      (item) => (item.payload.status ?? "active") === "active",
    );
    if (active === undefined) return;
    const data = new FormData(event.currentTarget);
    const outcome = String(data.get("outcome")) as "abandoned" | "completed";
    try {
      await commit(
        "study_session",
        active.entity.entity_id,
        {
          ...active.payload,
          status: outcome,
          outcome,
          ended_at: new Date().toISOString(),
          manual_minutes: Number(data.get("manual_minutes") ?? 0),
          reflection: String(data.get("reflection") ?? ""),
        },
        active.entity,
      );
      event.currentTarget.reset();
      setStatus("会话记录已保存；任务不会因此自动完成或通过验收。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function submitEvidence(
    event: FormEvent<HTMLFormElement>,
    task: LocalView<TaskPayload>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const evidenceType = String(data.get("evidence_type")) as
      | "text"
      | "link"
      | "note"
      | "resource";
    const summary = String(data.get("summary") ?? "").trim();
    const externalUrl = String(data.get("external_url") ?? "").trim();
    const referenceId = String(data.get("reference_id") ?? "");
    if (evidenceType === "text" && !summary) {
      setStatus("文字证据需要填写内容。");
      return;
    }
    if (evidenceType === "link" && !/^https?:\/\//i.test(externalUrl)) {
      setStatus("链接证据必须使用 HTTP 或 HTTPS 地址。");
      return;
    }
    const availableReferences = evidenceType === "note" ? notes : resources;
    if (
      (evidenceType === "note" || evidenceType === "resource") &&
      !availableReferences.some(
        (item) =>
          item.entity.entity_id === referenceId &&
          item.payload.space_id === task.payload.space_id,
      )
    ) {
      setStatus("请选择当前空间中已保存的笔记或资料。");
      return;
    }
    try {
      let dependency: string[] = [];
      if (task.payload.status === "in_progress") {
        const transition = await commit(
          "task",
          task.entity.entity_id,
          { ...task.payload, status: "submitted", blocked_reason: null },
          task.entity,
        );
        dependency = [transition.operation.operation_id];
      }
      const verificationId = crypto.randomUUID();
      await commit(
        "evidence",
        crypto.randomUUID(),
        {
          space_id: task.payload.space_id,
          verification_id: verificationId,
          task_id: task.entity.entity_id,
          evidence_type: evidenceType,
          note_id: evidenceType === "note" ? referenceId : null,
          resource_id: evidenceType === "resource" ? referenceId : null,
          summary,
          external_url: evidenceType === "link" ? externalUrl : null,
        },
        undefined,
        dependency,
      );
      form.reset();
      setStatus("证据和待验收状态已保存在本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function decideVerification(
    event: FormEvent<HTMLFormElement>,
    verification: LocalView<VerificationPayload>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const verdict = String(data.get("verdict")) as
      | "passed"
      | "failed"
      | "needs_revision";
    try {
      await commit(
        "verification",
        verification.entity.entity_id,
        {
          ...verification.payload,
          action: "decide",
          verdict,
          reviewer_notes: String(data.get("reviewer_notes") ?? "").trim(),
        },
        verification.entity,
      );
      setStatus("人工验收决定已保存在本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function closeVerifiedTask(
    verification: LocalView<VerificationPayload>,
    task: LocalView<TaskPayload>,
  ) {
    try {
      await commit(
        "verification",
        verification.entity.entity_id,
        {
          ...verification.payload,
          action: "close_task",
          expected_task_version: task.entity.server_version,
        },
        verification.entity,
      );
      setStatus("关闭任务操作已保存在本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  const visibleGoals = goals.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleTasks = tasks.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const activeSession = sessions.find(
    (item) =>
      item.payload.space_id === spaceId && item.payload.status === "active",
  );
  const visibleEvidence = evidence.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleVerifications = verifications.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleNotes = notes.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleResources = resources.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const completedTasks = visibleTasks.filter((item) =>
    ["done", "verified"].includes(item.payload.status),
  ).length;
  const actionableTasks = visibleTasks.filter((item) =>
    ["backlog", "planned", "in_progress"].includes(item.payload.status),
  );
  const blockedTasks = visibleTasks.filter(
    (item) => item.payload.status === "blocked",
  ).length;
  const pendingVerifications = visibleVerifications.filter(
    (item) => item.payload.verdict === "pending",
  ).length;
  const completedMinutes = sessions
    .filter(
      (item) =>
        item.payload.space_id === spaceId &&
        item.payload.status === "completed",
    )
    .reduce((total, item) => total + (item.payload.manual_minutes ?? 0), 0);
  const completionRate = visibleTasks.length
    ? (completedTasks / visibleTasks.length) * 100
    : 0;
  const taskStatusChart = [
    {
      label: "待开始",
      value: visibleTasks.filter((item) =>
        ["backlog", "planned"].includes(item.payload.status),
      ).length,
    },
    {
      label: "进行中",
      value: visibleTasks.filter(
        (item) => item.payload.status === "in_progress",
      ).length,
    },
    {
      label: "待验收",
      value: visibleTasks.filter((item) => item.payload.status === "submitted")
        .length,
    },
    { label: "已完成", value: completedTasks },
  ];
  const orderedActionableTasks = [...actionableTasks].sort((left, right) => {
    if (left.payload.status === "in_progress") return -1;
    if (right.payload.status === "in_progress") return 1;
    const leftDue = left.payload.due_at
      ? Date.parse(left.payload.due_at)
      : Infinity;
    const rightDue = right.payload.due_at
      ? Date.parse(right.payload.due_at)
      : Infinity;
    const dueDelta =
      (Number.isFinite(leftDue) ? leftDue : Infinity) -
      (Number.isFinite(rightDue) ? rightDue : Infinity);
    if (dueDelta !== 0) return dueDelta;
    return right.payload.priority - left.payload.priority;
  });
  const activeTask = activeSession
    ? visibleTasks.find(
        (task) => task.entity.entity_id === activeSession.payload.task_id,
      )
    : undefined;
  const nextTask = activeTask ?? orderedActionableTasks[0];
  const nextGoal = nextTask
    ? visibleGoals.find(
        (goal) => goal.entity.entity_id === nextTask.payload.goal_id,
      )
    : undefined;
  const nextPhase =
    nextTask && nextGoal
      ? nextGoal.payload.phases.find(
          (phase) => phase.id === nextTask.payload.phase_id,
        )
      : undefined;
  const nextTaskEvidence = nextTask
    ? visibleEvidence.filter(
        (item) => item.payload.task_id === nextTask.entity.entity_id,
      )
    : [];
  const nextTaskPendingVerification = nextTask
    ? visibleVerifications.filter(
        (item) =>
          item.payload.task_id === nextTask.entity.entity_id &&
          item.payload.verdict === "pending",
      ).length
    : 0;
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
  const hasPendingDashboardData =
    conflictCount > 0 ||
    dashboardRecords.some((record) => record.syncStatus !== "clean") ||
    [...tasks, ...sessions].some((item) => item.entity.sync_status !== "clean");
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
                  : dashboardRecords.length + tasks.length + sessions.length ===
                      0
                    ? "empty"
                    : "ready";

  return (
    <main id="main-content" className="settings-page today-page">
      <ProductPageHeader
        eyebrow="TODAY · EXECUTION COCKPIT"
        title="今天先推进最重要的一步"
        description={
          <>
            <p>
              把任务、专注、复习与证据汇成一条可执行时间线；首屏直接告诉你下一步是什么。
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
        actions={
          <>
            {!unlocked ? (
              <a className="product-action-link" href="#today-vault">
                解锁本地资料
              </a>
            ) : null}
            <button
              type="button"
              disabled={!unlocked}
              onClick={() => void synchronize()}
            >
              立即同步
            </button>
          </>
        }
      />

      <PersonaTodayOverview
        onRetry={() => void loadContext()}
        source={dashboardSource}
        state={dashboardState}
      />

      {conflictCount > 0 ? (
        <p className="residual-data-warning" role="alert">
          有 {conflictCount} 项同步冲突等待处理，系统没有静默覆盖任何一方。
        </p>
      ) : null}

      <div className="product-layout product-today-layout">
        <div className="product-grid product-today-main">
          <ProductWorkflowStage
            badge={
              <ProductTag tone={activeSession ? "good" : "info"}>
                {activeSession
                  ? "FOCUS SESSION · 进行中"
                  : nextTask
                    ? `NEXT ACTION · ${nextTask.payload.estimated_minutes} MIN`
                    : "NEXT ACTION · 待安排"}
              </ProductTag>
            }
            title={nextTask?.payload.title ?? "建立今天的第一项学习任务"}
            stepsLabel="今日执行流程"
            steps={[
              {
                label: "确定下一项任务",
                detail: nextTask
                  ? `${nextTask.payload.estimated_minutes} 分钟 · 优先级 ${nextTask.payload.priority}`
                  : "从可验收目标拆出今天的一步",
                state: nextTask || activeSession ? "complete" : "current",
              },
              {
                label: "完成一次专注",
                detail: activeSession
                  ? "会话正在进行，结束时记录结果"
                  : "选择任务后开始记录真实投入",
                state: activeSession
                  ? "current"
                  : nextTask
                    ? "current"
                    : "pending",
              },
              {
                label: "提交成果证据",
                detail: pendingVerifications
                  ? `${pendingVerifications} 项等待人工验收`
                  : "用笔记、链接或资料证明产出",
                state: pendingVerifications
                  ? "attention"
                  : visibleEvidence.length
                    ? "complete"
                    : "pending",
              },
            ]}
            actions={
              activeSession ? (
                <a
                  className="product-action-link primary"
                  href="#focus-session"
                >
                  继续本次专注
                </a>
              ) : nextTask ? (
                <button
                  type="button"
                  onClick={() => void startSession(nextTask)}
                >
                  ▶ 开始任务
                </button>
              ) : (
                <Link
                  className="product-action-link primary"
                  href="/app/planning"
                >
                  建立学习计划
                </Link>
              )
            }
          >
            <div className="today-action-brief">
              <div>
                <span>WHY</span>
                <strong>
                  {nextGoal?.payload.title ??
                    "先建立一个可验收目标，再安排今天的第一步。"}
                </strong>
                <small>
                  {nextPhase?.title ??
                    nextTask?.payload.description ??
                    "每次只推进一个能在单次专注中完成的动作。"}
                </small>
              </div>
              <div>
                <span>EVIDENCE</span>
                <strong>
                  {nextTaskEvidence.length
                    ? `${nextTaskEvidence.length} 条成果已记录`
                    : "完成后留下笔记、链接或资料"}
                </strong>
                <small>
                  {nextTaskPendingVerification
                    ? `${nextTaskPendingVerification} 项等待人工验收`
                    : "不会自动接受正式结论"}
                </small>
              </div>
              <div>
                <span>NEXT</span>
                <strong>
                  {activeSession
                    ? "结束专注并提交成果"
                    : nextTask
                      ? "开始一次专注"
                      : "打开计划建立动作"}
                </strong>
                <small>
                  {nextTask
                    ? `预计 ${nextTask.payload.estimated_minutes} 分钟`
                    : "完成后会回到今天的行动线"}
                </small>
              </div>
            </div>
          </ProductWorkflowStage>

          <div className="product-metric-grid product-metric-grid-workflow">
            <ProductMetric
              label="今日投入"
              value={`${completedMinutes}m`}
              detail="来自已完成会话"
              tone="info"
            />
            <ProductMetric
              label="完成任务"
              value={`${completedTasks} / ${visibleTasks.length}`}
              detail={
                visibleTasks.length
                  ? `${Math.round(completionRate)}% 完成率`
                  : "尚无任务，暂不计算比例"
              }
              tone="good"
            />
            <ProductMetric
              label="待推进"
              value={actionableTasks.length}
              detail="已按状态进入队列"
              tone={actionableTasks.length > 0 ? "warn" : "default"}
            />
            <ProductMetric
              label="证据验收"
              value={pendingVerifications}
              detail={`${visibleEvidence.length} 条证据已记录`}
              tone={pendingVerifications > 0 ? "warn" : "default"}
            />
          </div>

          <ProductPanel
            title="今日执行序列"
            description="按当前状态与优先级呈现下一批可以直接推进的任务。"
            aside={<ProductTag>{actionableTasks.length} 项</ProductTag>}
          >
            <div className="product-task-list">
              {orderedActionableTasks.slice(0, 3).map((task, index) => (
                <ProductTaskRow
                  key={task.entity.entity_id}
                  icon={
                    task.payload.status === "in_progress"
                      ? "▶"
                      : String(index + 1).padStart(2, "0")
                  }
                  title={task.payload.title}
                  description={`预计 ${task.payload.estimated_minutes} 分钟 · 优先级 ${task.payload.priority}`}
                  aside={
                    <ProductTag
                      tone={
                        task.payload.status === "in_progress"
                          ? "good"
                          : "default"
                      }
                    >
                      {task.payload.status === "in_progress" ? "NOW" : "NEXT"}
                    </ProductTag>
                  }
                />
              ))}
              {actionableTasks.length === 0 ? (
                <ProductEmptyState
                  icon="＋"
                  title="今天还没有执行序列"
                  description="从学习目标拆出一个 25–90 分钟可完成的动作，今日页会自动把它放到下一步。"
                  action={
                    <Link className="product-action-link" href="/app/planning">
                      打开计划
                    </Link>
                  }
                />
              ) : null}
            </div>
          </ProductPanel>
        </div>

        <aside className="product-grid product-sidebar-stack">
          <ProductPanel
            title="需要你处理"
            description="只提示真实阻塞，不自动改变核心记录。"
            aside={
              <ProductTag
                tone={
                  conflictCount + pendingVerifications + blockedTasks > 0
                    ? "warn"
                    : "good"
                }
              >
                {conflictCount + pendingVerifications + blockedTasks}
              </ProductTag>
            }
          >
            {conflictCount + pendingVerifications + blockedTasks > 0 ? (
              <ProductSignalList
                label="当前阻塞与待处理信号"
                items={[
                  ...(conflictCount > 0
                    ? [
                        {
                          description: "需要人工选择保留或合并的版本",
                          id: "sync-conflicts",
                          title: `${conflictCount} 项同步冲突`,
                          tone: "bad" as const,
                        },
                      ]
                    : []),
                  ...(blockedTasks > 0
                    ? [
                        {
                          description: "查看阻塞原因并决定下一步",
                          id: "blocked-tasks",
                          title: `${blockedTasks} 项任务受阻`,
                          tone: "warn" as const,
                        },
                      ]
                    : []),
                  ...(pendingVerifications > 0
                    ? [
                        {
                          description: "验收决定始终由你确认",
                          id: "pending-verifications",
                          title: `${pendingVerifications} 项证据待验收`,
                          tone: "info" as const,
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
            {conflictCount + pendingVerifications + blockedTasks === 0 ? (
              <ProductEmptyState
                icon="✓"
                title="当前没有阻塞项"
                description="同步冲突、受阻任务和待验收证据会集中出现在这里。"
              />
            ) : null}
          </ProductPanel>

          <ProductPanel
            title="本周能力变化"
            description="只在产生测验、成果和复习证据后更新。"
          >
            <div className="product-mini-kpi">
              <span>目标覆盖</span>
              <strong>{visibleGoals.length}</strong>
            </div>
            <div className="product-mini-kpi">
              <span>有效产出</span>
              <strong>{visibleEvidence.length}</strong>
            </div>
            <div className="product-mini-kpi">
              <span>完成任务</span>
              <strong>{completedTasks}</strong>
            </div>
            {visibleGoals.length + visibleEvidence.length + completedTasks ===
            0 ? (
              <p className="product-muted-note">
                完成第一项任务并留下证据后，这里会开始形成个人趋势。
              </p>
            ) : null}
          </ProductPanel>

          <ProductPanel
            title="快速开始"
            description="从现有真实入口建立结构化工作流。"
          >
            <div className="product-quick-links">
              <Link className="product-action-link" href="/app/planning">
                ▦ 建立学习路线
              </Link>
              <Link className="product-action-link" href="/app/records">
                ▦ 新建学习笔记
              </Link>
              <Link className="product-action-link" href="/app/templates">
                ▦ 浏览工作流模板
              </Link>
            </div>
          </ProductPanel>
        </aside>
      </div>

      <ProductDisclosure
        id="today-vault"
        summary="学习空间与本地资料"
        description="选择工作区、空间并解锁端侧加密资料"
        defaultOpen={!unlocked}
      >
        <div className="inline-form">
          <label htmlFor="today-workspace">工作区</label>
          <select
            id="today-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="today-space">空间</label>
          <select
            id="today-space"
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            {spaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.visibility === "private" ? "私有" : "共享"}
              </option>
            ))}
          </select>
        </div>
        <form className="inline-form" onSubmit={unlock}>
          <label htmlFor="today-passphrase">本地口令</label>
          <input
            id="today-passphrase"
            name="passphrase"
            type="password"
            minLength={10}
            autoComplete="current-password"
            required
          />
          <button type="submit">{unlocked ? "重新解锁" : "解锁资料"}</button>
        </form>
      </ProductDisclosure>

      <ProductDisclosure
        summary="安排一项今日任务"
        description="从既有目标拆出可在一次专注会话内推进的动作"
      >
        {visibleGoals.length === 0 ? (
          <ProductEmptyState
            icon="＋"
            title="先建立一个学习目标"
            description="当前空间还没有本地目标。前往“计划”创建并同步目标后，即可把下一步安排到今天。"
          />
        ) : (
          <form className="planning-form" onSubmit={createTask}>
            <label htmlFor="today-goal">关联目标</label>
            <select id="today-goal" name="goal_id" required>
              {visibleGoals.map((item) => (
                <option
                  key={item.entity.entity_id}
                  value={item.entity.entity_id}
                >
                  {item.payload.title}
                </option>
              ))}
            </select>
            <label htmlFor="today-phase">关联阶段（可选）</label>
            <select id="today-phase" name="phase_id">
              <option value="">不指定阶段</option>
              {visibleGoals.flatMap((goal) =>
                goal.payload.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {goal.payload.title} · {phase.title}
                  </option>
                )),
              )}
            </select>
            <label htmlFor="today-title">任务名称</label>
            <input id="today-title" name="title" maxLength={200} required />
            <label htmlFor="today-description">任务说明</label>
            <textarea
              id="today-description"
              name="description"
              maxLength={10000}
            />
            <label htmlFor="today-minutes">预计分钟</label>
            <input
              id="today-minutes"
              name="estimated_minutes"
              type="number"
              min={0}
              max={1000000}
              defaultValue={60}
              required
            />
            <label htmlFor="today-priority">优先级</label>
            <select id="today-priority" name="priority" defaultValue="2">
              <option value="4">最高</option>
              <option value="3">高</option>
              <option value="2">中</option>
              <option value="1">低</option>
              <option value="0">最低</option>
            </select>
            <button type="submit" disabled={!unlocked}>
              保存到本地
            </button>
          </form>
        )}
      </ProductDisclosure>

      <div className="product-dashboard-grid product-dashboard-grid-wide">
        <ProductPanel title="任务节奏" description="当前空间的任务状态分布">
          <ProductBarChart items={taskStatusChart} label="任务状态分布" />
          {visibleTasks.length ? (
            <ProductProgress
              label="整体完成率"
              value={completionRate}
              tone="good"
            />
          ) : (
            <p className="product-muted-note">
              创建第一项任务后再计算整体完成率。
            </p>
          )}
        </ProductPanel>
        <ProductPanel
          title="学习活跃度"
          description="当前空间已形成的真实学习记录。"
        >
          <ProductSignalGrid
            label="学习活跃度指标"
            items={[
              { id: "tasks", label: "任务", value: visibleTasks.length },
              {
                id: "focus-minutes",
                label: "专注分钟",
                value: completedMinutes,
              },
              {
                id: "evidence",
                label: "证据",
                value: visibleEvidence.length,
              },
              {
                id: "verifications",
                label: "验收记录",
                value: visibleVerifications.length,
              },
            ]}
          />
        </ProductPanel>
      </div>

      <ProductPanel
        className="sync-wide-card"
        title="完整任务队列"
        description="开始专注、更新状态，并用证据连接学习投入与实际产出。"
        aside={<ProductTag>{visibleTasks.length} 项</ProductTag>}
      >
        <div className="task-grid">
          {visibleTasks.map((task) => {
            const taskStatus = task.payload.status ?? "planned";
            return (
              <article className="task-card" key={task.entity.entity_id}>
                <div>
                  <span className="count-badge">{taskStatus}</span>
                  <h3>{task.payload.title}</h3>
                  <p>{task.payload.description || "暂无说明"}</p>
                  <small>
                    预计 {task.payload.estimated_minutes} 分钟 ·{" "}
                    {task.entity.sync_status}
                  </small>
                </div>
                <div className="task-actions">
                  {taskStatus === "planned" || taskStatus === "in_progress" ? (
                    <button
                      type="button"
                      onClick={() => void startSession(task)}
                    >
                      开始会话
                    </button>
                  ) : null}
                  {taskStatus === "backlog" ? (
                    <button
                      type="button"
                      onClick={() => void transitionTask(task, "planned")}
                    >
                      安排任务
                    </button>
                  ) : null}
                  {taskStatus === "in_progress" ? (
                    <button
                      type="button"
                      onClick={() => void transitionTask(task, "submitted")}
                    >
                      提交待验收
                    </button>
                  ) : null}
                  {taskStatus === "planned" || taskStatus === "in_progress" ? (
                    <button
                      type="button"
                      onClick={() => void transitionTask(task, "blocked")}
                    >
                      标记阻塞
                    </button>
                  ) : null}
                </div>
                {taskStatus === "in_progress" || taskStatus === "submitted" ? (
                  <form
                    className="planning-form"
                    onSubmit={(event) => void submitEvidence(event, task)}
                  >
                    <h4>提交证据并进入人工验收</h4>
                    <label htmlFor={`evidence-type-${task.entity.entity_id}`}>
                      证据类型
                    </label>
                    <select
                      id={`evidence-type-${task.entity.entity_id}`}
                      name="evidence_type"
                      defaultValue="text"
                    >
                      <option value="text">文字说明</option>
                      <option value="link">HTTP(S) 链接</option>
                      <option value="note">已保存笔记</option>
                      <option value="resource">已保存资料</option>
                    </select>
                    <label
                      htmlFor={`evidence-summary-${task.entity.entity_id}`}
                    >
                      证据说明
                    </label>
                    <textarea
                      id={`evidence-summary-${task.entity.entity_id}`}
                      name="summary"
                      maxLength={10000}
                    />
                    <label htmlFor={`evidence-url-${task.entity.entity_id}`}>
                      链接（仅链接证据）
                    </label>
                    <input
                      id={`evidence-url-${task.entity.entity_id}`}
                      name="external_url"
                      type="url"
                      maxLength={4096}
                      placeholder="https://example.com/result"
                    />
                    <label
                      htmlFor={`evidence-reference-${task.entity.entity_id}`}
                    >
                      笔记或资料（仅引用证据）
                    </label>
                    <select
                      id={`evidence-reference-${task.entity.entity_id}`}
                      name="reference_id"
                      defaultValue=""
                    >
                      <option value="">请选择</option>
                      <optgroup label="笔记">
                        {visibleNotes.map((item) => (
                          <option
                            key={`note-${item.entity.entity_id}`}
                            value={item.entity.entity_id}
                          >
                            {item.payload.title}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="资料">
                        {visibleResources.map((item) => (
                          <option
                            key={`resource-${item.entity.entity_id}`}
                            value={item.entity.entity_id}
                          >
                            {item.payload.title}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <button type="submit">保存证据到本地</button>
                  </form>
                ) : null}
              </article>
            );
          })}
          {visibleTasks.length === 0 ? (
            <ProductEmptyState
              icon="◎"
              title="今天还没有任务"
              description="把目标拆成一个 25–90 分钟可完成的动作，今天只推进最关键的一步。"
            />
          ) : null}
        </div>
      </ProductPanel>

      <ProductPanel
        className="sync-wide-card"
        title="证据与人工验收"
        description="把成果、资料或笔记关联到任务；所有验收决定都需要你明确确认。"
        aside={
          <ProductTag tone={pendingVerifications > 0 ? "warn" : "good"}>
            {pendingVerifications > 0
              ? `${pendingVerifications} 项待处理`
              : "暂无积压"}
          </ProductTag>
        }
      >
        <div className="task-grid">
          {visibleVerifications.map((verification) => {
            const task = visibleTasks.find(
              (item) => item.entity.entity_id === verification.payload.task_id,
            );
            const evidenceItem = visibleEvidence.find(
              (item) =>
                item.entity.entity_id === verification.payload.evidence_id,
            );
            return (
              <article
                className="task-card"
                key={verification.entity.entity_id}
              >
                <div>
                  <span className="count-badge">
                    {verification.payload.verdict}
                  </span>
                  <h3>{task?.payload.title ?? "待验收任务"}</h3>
                  <p>{evidenceItem?.payload.summary || "关联证据已记录"}</p>
                  <small>人工验收 · {verification.entity.sync_status}</small>
                  <dl className="product-evidence-trace">
                    <div>
                      <dt>任务</dt>
                      <dd>{verification.payload.task_id}</dd>
                    </div>
                    <div>
                      <dt>证据</dt>
                      <dd>{verification.payload.evidence_id}</dd>
                    </div>
                    <div>
                      <dt>验收记录</dt>
                      <dd>{verification.entity.entity_id}</dd>
                    </div>
                  </dl>
                  <Link className="product-action-link" href="/app/audit">
                    核对服务器审计时间线
                  </Link>
                </div>
                {verification.payload.verdict === "pending" ? (
                  <form
                    className="planning-form"
                    onSubmit={(event) =>
                      void decideVerification(event, verification)
                    }
                  >
                    <label
                      htmlFor={`verification-verdict-${verification.entity.entity_id}`}
                    >
                      人工决定
                    </label>
                    <select
                      id={`verification-verdict-${verification.entity.entity_id}`}
                      name="verdict"
                      defaultValue="passed"
                    >
                      <option value="passed">通过</option>
                      <option value="needs_revision">需要修改</option>
                      <option value="failed">不通过</option>
                    </select>
                    <label
                      htmlFor={`verification-notes-${verification.entity.entity_id}`}
                    >
                      验收意见
                    </label>
                    <textarea
                      id={`verification-notes-${verification.entity.entity_id}`}
                      name="reviewer_notes"
                      maxLength={10000}
                    />
                    <button type="submit">确认人工验收决定</button>
                  </form>
                ) : null}
                {verification.payload.verdict === "passed" &&
                task?.payload.status === "verified" ? (
                  <button
                    type="button"
                    onClick={() => void closeVerifiedTask(verification, task)}
                  >
                    关闭已验收任务
                  </button>
                ) : null}
                {verification.payload.reviewer_notes ? (
                  <p>验收意见：{verification.payload.reviewer_notes}</p>
                ) : null}
              </article>
            );
          })}
          {visibleVerifications.length === 0 ? (
            <ProductEmptyState
              icon="◇"
              title="暂无验收记录"
              description="任务产生可检查的成果后，在任务卡片中提交证据并发起人工验收。"
            />
          ) : null}
        </div>
      </ProductPanel>

      <ProductPanel
        className="sync-wide-card"
        id="focus-session"
        title="专注会话"
        description="结束会话时记录实际投入、结果和下一步，让进度可回顾。"
        aside={
          <ProductTag tone={activeSession ? "good" : "default"}>
            {activeSession ? "进行中" : "未开始"}
          </ProductTag>
        }
      >
        {activeSession === undefined ? (
          <ProductEmptyState
            icon="▶"
            title="准备好进入专注了吗？"
            description="从任务队列选择一项计划中或进行中的任务，开始后在这里记录本次成果。"
          />
        ) : (
          <form className="planning-form" onSubmit={finishSession}>
            <p>
              会话关联任务：
              {visibleTasks.find(
                (task) =>
                  task.entity.entity_id === activeSession.payload.task_id,
              )?.payload.title ?? activeSession.payload.task_id}
            </p>
            <label htmlFor="session-minutes">实际分钟</label>
            <input
              id="session-minutes"
              name="manual_minutes"
              type="number"
              min={0}
              max={1440}
              required
            />
            <label htmlFor="session-reflection">反思与下一步</label>
            <textarea
              id="session-reflection"
              name="reflection"
              maxLength={10000}
            />
            <label htmlFor="session-outcome">结束方式</label>
            <select
              id="session-outcome"
              name="outcome"
              defaultValue="completed"
            >
              <option value="completed">完成本次会话</option>
              <option value="abandoned">放弃本次会话</option>
            </select>
            <button type="submit">保存会话记录</button>
          </form>
        )}
      </ProductPanel>
    </main>
  );
}
