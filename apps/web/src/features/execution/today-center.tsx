"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  databaseNameForUser,
  OfflineVault,
  openOfflineDatabase,
  ProtectedOfflineRepository,
  SyncClient,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "@logion/offline";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useSession } from "@/features/auth/session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];

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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("正在准备今日工作台……");
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
  const database = useRef<LogionOfflineDatabase | null>(null);
  const vault = useRef<OfflineVault | null>(null);

  const loadContext = useCallback(async () => {
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
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, []);

  const loadSpaces = useCallback(async (selectedWorkspace: string) => {
    try {
      const result = await browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${selectedWorkspace}/spaces`,
      );
      setSpaces(result.spaces);
      setSpaceId((current) =>
        result.spaces.some((item) => item.id === current)
          ? current
          : (result.spaces[0]?.id ?? ""),
      );
    } catch (error) {
      setSpaces([]);
      setSpaceId("");
      setStatus(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadContext());
    return () => database.current?.close();
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
    const [
      taskRows,
      sessionRows,
      goalRows,
      evidenceRows,
      verificationRows,
      noteRows,
      resourceRows,
      openConflicts,
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
    ]);
    const [
      nextTasks,
      nextSessions,
      nextGoals,
      nextEvidence,
      nextVerifications,
      nextNotes,
      nextResources,
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
    ]);
    setTasks(nextTasks);
    setSessions(nextSessions);
    setGoals(nextGoals);
    setEvidence(nextEvidence);
    setVerifications(nextVerifications);
    setNotes(nextNotes);
    setResources(nextResources);
    setConflictCount(openConflicts);
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId) return;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    try {
      database.current?.close();
      const db = await openOfflineDatabase({
        databaseName: databaseNameForUser(session.user.id),
        indexedDB: globalThis.indexedDB ?? null,
        IDBKeyRange: globalThis.IDBKeyRange ?? null,
      });
      const localVault = new OfflineVault(db);
      if ((await db.vaultMetadata.get(session.user.id)) === undefined) {
        await localVault.initialize(session.user.id, passphrase);
      } else {
        await localVault.unlock(session.user.id, passphrase);
      }
      database.current = db;
      vault.current = localVault;
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setUnlocked(true);
      setStatus(
        "今日数据已解锁；断网后仍可完整编辑。完成会话不会自动验收任务。",
      );
      event.currentTarget.reset();
    } catch (error) {
      setUnlocked(false);
      setStatus(errorMessage(error));
    }
  }

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
    (item) => item.payload.status === "active",
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

  return (
    <main id="main-content" className="settings-page today-page">
      <header>
        <p className="eyebrow">LOGION · TODAY</p>
        <h1>把今天的学习变成可追溯记录</h1>
        <p aria-live="polite">{status}</p>
        {conflictCount > 0 ? (
          <p className="residual-data-warning" role="alert">
            有 {conflictCount} 项同步冲突等待处理，系统没有静默覆盖任何一方。
          </p>
        ) : null}
      </header>

      <section className="settings-card">
        <h2>学习上下文</h2>
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
          <button
            type="button"
            disabled={!unlocked}
            onClick={() => void synchronize()}
          >
            立即同步
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h2>本地解锁</h2>
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
          <button type="submit">{unlocked ? "重新解锁" : "解锁"}</button>
        </form>
      </section>

      <section className="settings-card">
        <h2>新建今日任务</h2>
        {visibleGoals.length === 0 ? (
          <p className="empty-state">
            当前空间还没有本地目标，请先到“计划”创建并同步目标。
          </p>
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
      </section>

      <section className="settings-card sync-wide-card">
        <h2>任务队列</h2>
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
            <p className="empty-state">当前空间还没有任务。</p>
          ) : null}
        </div>
      </section>

      <section className="settings-card sync-wide-card">
        <h2>证据与人工验收</h2>
        <p>所有决定都需要人明确点击确认；AI 建议不会自动改变验收或任务状态。</p>
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
            <p className="empty-state">当前空间还没有待验收记录。</p>
          ) : null}
        </div>
      </section>

      <section className="settings-card sync-wide-card">
        <h2>当前学习会话</h2>
        {activeSession === undefined ? (
          <p className="empty-state">
            没有进行中的会话。选择一个计划中或进行中的任务开始。
          </p>
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
      </section>
    </main>
  );
}
