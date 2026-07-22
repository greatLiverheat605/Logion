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

interface ExamPayload extends JsonObject {
  space_id: string;
  title: string;
  date_status: "scheduled" | "undetermined";
  exam_at: string | null;
  timezone: string | null;
  target_score: number | null;
  score_scale_max: number | null;
  status: "planning" | "active" | "completed" | "archived";
}

interface ExamView {
  entity: LocalEntity;
  payload: ExamPayload;
}

interface SubjectPayload extends JsonObject {
  space_id: string;
  exam_id: string;
  name: string;
  weight_basis_points: number;
  status: "active" | "archived";
}

interface SyllabusNodePayload extends JsonObject {
  space_id: string;
  subject_id: string;
  parent_id: string | null;
  title: string;
  importance: number;
  coverage_status: "not_started" | "in_progress" | "covered";
}

interface ProtectedView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

function SyllabusTree({
  nodes,
  parentId = null,
}: {
  nodes: ProtectedView<SyllabusNodePayload>[];
  parentId?: string | null;
}) {
  const children = nodes.filter((node) => node.payload.parent_id === parentId);
  if (children.length === 0) return null;
  return (
    <ul>
      {children.map((node) => (
        <li key={node.entity.entity_id}>
          {node.payload.title} · 重要度 {node.payload.importance} · 未开始
          <SyllabusTree nodes={nodes} parentId={node.entity.entity_id} />
        </li>
      ))}
    </ul>
  );
}

const EXAM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const EXAM_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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

function message(error: unknown): string {
  if (error instanceof LogionApiError) {
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  return "网络暂不可用；考试数据仍保存在本机 Outbox。";
}

function countdown(examAt: string | null): string {
  if (examAt === null) return "日期待定";
  const difference = new Date(examAt).getTime() - Date.now();
  if (!Number.isFinite(difference)) return "日期无效";
  if (difference <= 0) return "考试时间已到或已过去";
  const days = Math.ceil(difference / 86_400_000);
  return `剩余 ${days} 天`;
}

export function ExamCenter() {
  const { state: session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [dateStatus, setDateStatus] = useState<"scheduled" | "undetermined">(
    "scheduled",
  );
  const [syllabusSubjectId, setSyllabusSubjectId] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("正在准备备考空间……");
  const [exams, setExams] = useState<ExamView[]>([]);
  const [subjects, setSubjects] = useState<ProtectedView<SubjectPayload>[]>([]);
  const [syllabusNodes, setSyllabusNodes] = useState<
    ProtectedView<SyllabusNodePayload>[]
  >([]);
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
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceId((current) =>
        workspaceResult.workspaces.some((item) => item.id === current)
          ? current
          : (workspaceResult.workspaces[0]?.id ?? ""),
      );
      setDeviceId(deviceResult.devices.find((item) => item.current)?.id ?? "");
      setStatus("请先解锁本地备考资料。");
    } catch (error) {
      setStatus(message(error));
    }
  }, []);

  const loadSpaces = useCallback(async (selected: string) => {
    try {
      const result = await browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${selected}/spaces`,
      );
      setSpaces(result.spaces);
      setSpaceId((current) =>
        result.spaces.some((item) => item.id === current)
          ? current
          : (result.spaces[0]?.id ?? ""),
      );
    } catch (error) {
      setStatus(message(error));
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
  ) {
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
    )
      throw new Error("invalid bootstrap response");
    await repository.stageChunk(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < validation.value.chunk_count; index += 1) {
      const chunk = await browserApiClient.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
        {
          method: "POST",
          body: JSON.stringify({
            message_type: "bootstrap_request",
            protocol_version: "sync-v1",
            workspace_id: workspaceId,
            device_id: deviceId,
            known_sync_epoch: validation.value.sync_epoch,
            snapshot_id: validation.value.snapshot_id,
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
    const activeDatabase = db;
    const activeVault = localVault;
    async function readProtected<T extends JsonObject>(entityType: string) {
      const rows = await activeDatabase.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, entityType])
        .toArray();
      return Promise.all(
        rows.map(async (entity) => {
          const reference = entity.payload.encrypted_payload_ref;
          const payload =
            typeof reference === "string"
              ? await activeVault.get(reference, workspaceId)
              : entity.payload;
          if (payload === null)
            throw new Error("protected payload unavailable");
          return { entity, payload: payload as T };
        }),
      );
    }
    const [nextExams, nextSubjects, nextNodes] = await Promise.all([
      readProtected<ExamPayload>("exam"),
      readProtected<SubjectPayload>("exam_subject"),
      readProtected<SyllabusNodePayload>("syllabus_node"),
    ]);
    setExams(nextExams);
    setSubjects(nextSubjects);
    setSyllabusNodes(nextNodes);
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
      setStatus("备考资料已解锁；考试可断网创建并稍后同步。");
      event.currentTarget.reset();
    } catch (error) {
      setUnlocked(false);
      setStatus(message(error));
    }
  }

  async function synchronize() {
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null || !workspaceId || !deviceId) return;
    try {
      await bootstrap(db, localVault);
      await new SyncClient(db, transport(workspaceId), localVault).synchronize(
        workspaceId,
        deviceId,
      );
      setStatus("备考数据已同步。");
    } catch (error) {
      setStatus(message(error));
    } finally {
      await refresh(db, localVault);
    }
  }

  async function createExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const examAt = String(data.get("exam_at") ?? "");
    const targetScore = String(data.get("target_score") ?? "");
    const scale = String(data.get("score_scale_max") ?? "");
    const now = new Date().toISOString();
    try {
      const payload: ExamPayload = {
        space_id: spaceId,
        title: String(data.get("title") ?? "").trim(),
        date_status: dateStatus,
        exam_at:
          dateStatus === "scheduled" && examAt
            ? new Date(examAt).toISOString()
            : null,
        timezone: dateStatus === "scheduled" ? EXAM_TIMEZONE : null,
        target_score: targetScore ? Number(targetScore) : null,
        score_scale_max: scale ? Number(scale) : null,
        status: "planning",
      };
      await new ProtectedOfflineRepository(db, localVault).commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: "exam",
        entity_id: crypto.randomUUID(),
        operation_type: "create",
        base_version: 0,
        local_revision: 1,
        client_occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: session.user.id,
        updated_by: session.user.id,
        payload,
      });
      form.reset();
      setStatus("考试已加密保存在本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
    }
  }

  async function pendingDependencies(entityIds: string[]): Promise<string[]> {
    const db = database.current;
    if (db === null) return [];
    const pending = await db.outbox
      .filter(
        (item) =>
          entityIds.includes(item.entity_id) &&
          ["pending", "retrying"].includes(item.outbox_state),
      )
      .toArray();
    return pending.map((item) => item.operation_id);
  }

  async function createSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const examId = String(data.get("exam_id") ?? "");
    const now = new Date().toISOString();
    try {
      await new ProtectedOfflineRepository(db, localVault).commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: "exam_subject",
        entity_id: crypto.randomUUID(),
        operation_type: "create",
        base_version: 0,
        local_revision: 1,
        client_occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: session.user.id,
        updated_by: session.user.id,
        payload: {
          space_id: spaceId,
          exam_id: examId,
          name: String(data.get("name") ?? "").trim(),
          weight_basis_points: Math.round(
            Number(data.get("weight_percent") ?? 0) * 100,
          ),
          status: "active",
        },
        dependencies: await pendingDependencies([examId]),
      });
      form.reset();
      setStatus("科目已加密保存，正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
    }
  }

  async function createSyllabusNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const subjectId = String(data.get("subject_id") ?? "");
    const parentId = String(data.get("parent_id") ?? "") || null;
    const now = new Date().toISOString();
    try {
      await new ProtectedOfflineRepository(db, localVault).commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: "syllabus_node",
        entity_id: crypto.randomUUID(),
        operation_type: "create",
        base_version: 0,
        local_revision: 1,
        client_occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: session.user.id,
        updated_by: session.user.id,
        payload: {
          space_id: spaceId,
          subject_id: subjectId,
          parent_id: parentId,
          title: String(data.get("title") ?? "").trim(),
          importance: Number(data.get("importance") ?? 3),
          coverage_status: "not_started",
        },
        dependencies: await pendingDependencies(
          parentId === null ? [subjectId] : [subjectId, parentId],
        ),
      });
      form.reset();
      setStatus("大纲节点已加密保存，正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
    }
  }

  const visibleExams = exams.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleSubjects = subjects.filter(
    (item) =>
      item.payload.space_id === spaceId &&
      visibleExams.some(
        (exam) => exam.entity.entity_id === item.payload.exam_id,
      ),
  );
  const visibleNodes = syllabusNodes.filter(
    (item) =>
      item.payload.space_id === spaceId &&
      visibleSubjects.some(
        (subject) => subject.entity.entity_id === item.payload.subject_id,
      ),
  );

  return (
    <main id="main-content" className="settings-page today-page">
      <header>
        <p className="eyebrow">LOGION · EXAM</p>
        <h1>用自己的考试上下文建立备考倒计时</h1>
        <p aria-live="polite">{status}</p>
      </header>

      <section className="settings-card">
        <h2>备考上下文</h2>
        <div className="inline-form">
          <label htmlFor="exam-workspace">工作区</label>
          <select
            id="exam-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="exam-space">空间</label>
          <select
            id="exam-space"
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            {spaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
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
          <label htmlFor="exam-passphrase">本地口令</label>
          <input
            id="exam-passphrase"
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
        <h2>创建考试</h2>
        <form className="planning-form" onSubmit={createExam}>
          <label htmlFor="exam-title">名称</label>
          <input id="exam-title" name="title" maxLength={160} required />
          <label htmlFor="exam-date-status">日期状态</label>
          <select
            id="exam-date-status"
            name="date_status"
            value={dateStatus}
            onChange={(event) =>
              setDateStatus(event.target.value as "scheduled" | "undetermined")
            }
          >
            <option value="scheduled">日期已确定</option>
            <option value="undetermined">日期待定</option>
          </select>
          {dateStatus === "scheduled" ? (
            <div>
              <label htmlFor="exam-at">考试时间（{EXAM_TIMEZONE}）</label>
              <input
                id="exam-at"
                name="exam_at"
                type="datetime-local"
                required
              />
            </div>
          ) : null}
          <label htmlFor="exam-target">目标分（可选）</label>
          <input id="exam-target" name="target_score" type="number" min={0} />
          <label htmlFor="exam-scale">满分（填写目标分时必填）</label>
          <input id="exam-scale" name="score_scale_max" type="number" min={1} />
          <button type="submit" disabled={!unlocked || !spaceId}>
            加密保存考试
          </button>
        </form>
      </section>

      <section className="settings-card">
        <h2>科目与权重</h2>
        <form className="planning-form" onSubmit={createSubject}>
          <label htmlFor="subject-exam">所属考试</label>
          <select id="subject-exam" name="exam_id" required>
            <option value="">请选择</option>
            {visibleExams.map((exam) => (
              <option key={exam.entity.entity_id} value={exam.entity.entity_id}>
                {exam.payload.title}
              </option>
            ))}
          </select>
          <label htmlFor="subject-name">科目名称</label>
          <input id="subject-name" name="name" maxLength={160} required />
          <label htmlFor="subject-weight">权重（百分比，可为 0）</label>
          <input
            id="subject-weight"
            name="weight_percent"
            type="number"
            min={0}
            max={100}
            step={0.01}
            defaultValue={0}
            required
          />
          <button
            type="submit"
            disabled={!unlocked || visibleExams.length === 0}
          >
            加密保存科目
          </button>
        </form>
      </section>

      <section className="settings-card">
        <h2>考试大纲</h2>
        <form className="planning-form" onSubmit={createSyllabusNode}>
          <label htmlFor="syllabus-subject">所属科目</label>
          <select
            id="syllabus-subject"
            name="subject_id"
            value={syllabusSubjectId}
            onChange={(event) => setSyllabusSubjectId(event.target.value)}
            required
          >
            <option value="">请选择</option>
            {visibleSubjects.map((subject) => (
              <option
                key={subject.entity.entity_id}
                value={subject.entity.entity_id}
              >
                {subject.payload.name}
              </option>
            ))}
          </select>
          <label htmlFor="syllabus-parent">父节点（可选）</label>
          <select id="syllabus-parent" name="parent_id">
            <option value="">顶层节点</option>
            {visibleNodes
              .filter((node) => node.payload.subject_id === syllabusSubjectId)
              .map((node) => (
                <option
                  key={node.entity.entity_id}
                  value={node.entity.entity_id}
                >
                  {node.payload.title}
                </option>
              ))}
          </select>
          <label htmlFor="syllabus-title">节点名称</label>
          <input id="syllabus-title" name="title" maxLength={240} required />
          <label htmlFor="syllabus-importance">重要度</label>
          <select id="syllabus-importance" name="importance" defaultValue="3">
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
          <button type="submit" disabled={!unlocked || !syllabusSubjectId}>
            加密保存大纲节点
          </button>
        </form>
      </section>

      <section className="settings-card sync-wide-card">
        <h2>我的考试</h2>
        <div className="task-grid">
          {visibleExams.map((exam) => (
            <article className="task-card" key={exam.entity.entity_id}>
              <span className="count-badge">
                {countdown(exam.payload.exam_at)}
              </span>
              <h3>{exam.payload.title}</h3>
              <p>
                {exam.payload.exam_at
                  ? EXAM_DATE_FORMATTER.format(new Date(exam.payload.exam_at))
                  : "考试日期尚未确定"}
              </p>
              <p>
                目标：
                {exam.payload.target_score !== null
                  ? `${exam.payload.target_score} / ${exam.payload.score_scale_max}`
                  : "未设置"}
              </p>
              <small>{exam.entity.sync_status}</small>
              <ul>
                {visibleSubjects
                  .filter(
                    (subject) =>
                      subject.payload.exam_id === exam.entity.entity_id,
                  )
                  .map((subject) => (
                    <li key={subject.entity.entity_id}>
                      {subject.payload.name} ·{" "}
                      {subject.payload.weight_basis_points / 100}%
                      <SyllabusTree
                        nodes={visibleNodes.filter(
                          (node) =>
                            node.payload.subject_id ===
                            subject.entity.entity_id,
                        )}
                      />
                    </li>
                  ))}
              </ul>
            </article>
          ))}
          {visibleExams.length === 0 ? (
            <p className="empty-state">当前空间还没有考试。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
