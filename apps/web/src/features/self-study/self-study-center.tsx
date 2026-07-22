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
type Kind =
  | "learning_track"
  | "study_project"
  | "inbox_item"
  | "deliverable"
  | "paper_record"
  | "research_claim"
  | "research_question"
  | "experiment_run"
  | "metric_record"
  | "research_feedback"
  | "rubric"
  | "group_review"
  | "group_feedback"
  | "report_snapshot";
interface View {
  entity: LocalEntity;
  payload: JsonObject;
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
function errorMessage(error: unknown) {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）。`
    : "网络暂不可用；内容仍保存在本机 Outbox。";
}

export function SelfStudyCenter() {
  return <OfflineLearningCenter mode="self-study" />;
}
export function ResearchCenter() {
  return <OfflineLearningCenter mode="research" />;
}
export function CollaborationCenter() {
  return <OfflineLearningCenter mode="collaboration" />;
}

function OfflineLearningCenter({
  mode,
}: {
  mode: "self-study" | "research" | "collaboration";
}) {
  const { state: session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState(""),
    [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState(""),
    [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState(() =>
    mode === "collaboration"
      ? "正在准备共享审阅空间……"
      : mode === "research"
        ? "正在准备研究空间……"
        : "正在准备自主学习空间……",
  );
  const [records, setRecords] = useState<Record<Kind, View[]>>({
    learning_track: [],
    study_project: [],
    inbox_item: [],
    deliverable: [],
    paper_record: [],
    research_claim: [],
    research_question: [],
    experiment_run: [],
    metric_record: [],
    research_feedback: [],
    rubric: [],
    group_review: [],
    group_feedback: [],
    report_snapshot: [],
  });
  const database = useRef<LogionOfflineDatabase | null>(null),
    vault = useRef<OfflineVault | null>(null);
  const loadContext = useCallback(async () => {
    try {
      const [w, d] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      setWorkspaces(w.workspaces);
      setWorkspaceId((x) =>
        w.workspaces.some((i) => i.id === x) ? x : (w.workspaces[0]?.id ?? ""),
      );
      setDeviceId(d.devices.find((i) => i.current)?.id ?? "");
      setStatus(
        mode === "collaboration"
          ? "请解锁本地共享审阅资料。"
          : mode === "research"
            ? "请解锁本地研究资料。"
            : "请解锁本地自主学习资料。",
      );
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [mode]);
  const loadSpaces = useCallback(
    async (id: string) => {
      try {
        const r = await browserApiClient.request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${id}/spaces`,
        );
        setSpaces(r.spaces);
        const eligible =
          mode === "collaboration"
            ? r.spaces.filter((space) => space.visibility === "shared")
            : r.spaces;
        setSpaceId((current) =>
          eligible.some((space) => space.id === current)
            ? current
            : (eligible[0]?.id ?? ""),
        );
      } catch (error) {
        setStatus(errorMessage(error));
      }
    },
    [mode],
  );
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
    const chunk = (
      snapshot_id: string | null,
      chunk_index: number | null,
      known_sync_epoch: string | null,
    ) =>
      browserApiClient.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
        {
          method: "POST",
          body: JSON.stringify({
            message_type: "bootstrap_request",
            protocol_version: "sync-v1",
            workspace_id: workspaceId,
            device_id: deviceId,
            known_sync_epoch,
            snapshot_id,
            chunk_index,
          }),
        },
      );
    const first = await chunk(null, null, current?.sync_epoch ?? null),
      validation = validateSyncV1Message(first);
    if (
      !validation.ok ||
      validation.value.message_type !== "bootstrap_response"
    )
      throw new Error("invalid bootstrap response");
    await repository.stageChunk(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < validation.value.chunk_count; index += 1)
      await repository.stageChunk(
        await chunk(
          validation.value.snapshot_id,
          index,
          validation.value.sync_epoch,
        ),
        { workspace_id: workspaceId, device_id: deviceId },
      );
  }
  async function refresh(db = database.current, localVault = vault.current) {
    if (!db || !localVault || !workspaceId) return;
    const activeDb = db,
      activeVault = localVault;
    const kinds: Kind[] = [
      "learning_track",
      "study_project",
      "inbox_item",
      "deliverable",
      "paper_record",
      "research_claim",
      "research_question",
      "experiment_run",
      "metric_record",
      "research_feedback",
      "rubric",
      "group_review",
      "group_feedback",
      "report_snapshot",
    ];
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const rows = await activeDb.entities
          .where("[workspace_id+entity_type]")
          .equals([workspaceId, kind])
          .toArray();
        const views = await Promise.all(
          rows.map(async (entity) => {
            const ref = entity.payload.encrypted_payload_ref;
            const payload =
              typeof ref === "string"
                ? await activeVault.get(ref, workspaceId)
                : entity.payload;
            if (!payload) throw new Error("protected payload unavailable");
            return { entity, payload };
          }),
        );
        return [kind, views] as const;
      }),
    );
    setRecords(Object.fromEntries(entries) as Record<Kind, View[]>);
  }
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId) return;
    try {
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase") ?? "",
      );
      database.current?.close();
      const db = await openOfflineDatabase({
        databaseName: databaseNameForUser(session.user.id),
        indexedDB: globalThis.indexedDB ?? null,
        IDBKeyRange: globalThis.IDBKeyRange ?? null,
      });
      const localVault = new OfflineVault(db);
      if ((await db.vaultMetadata.get(session.user.id)) === undefined)
        await localVault.initialize(session.user.id, passphrase);
      else await localVault.unlock(session.user.id, passphrase);
      database.current = db;
      vault.current = localVault;
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setUnlocked(true);
      setStatus("资料已解锁，可断网编辑并稍后同步。");
    } catch (error) {
      setUnlocked(false);
      setStatus(errorMessage(error));
    }
  }
  async function synchronize() {
    if (!database.current || !vault.current || !workspaceId || !deviceId)
      return;
    try {
      await bootstrap(database.current, vault.current);
      await new SyncClient(
        database.current,
        transport(workspaceId),
        vault.current,
      ).synchronize(workspaceId, deviceId);
      setStatus("自主学习资料已同步。");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      await refresh();
    }
  }
  async function dependencies(ids: string[]) {
    if (!database.current) return [];
    return (
      await database.current.outbox
        .filter(
          (x) =>
            ids.includes(x.entity_id) &&
            ["pending", "retrying"].includes(x.outbox_state),
        )
        .toArray()
    ).map((x) => x.operation_id);
  }
  async function commit(
    kind: Kind,
    payload: JsonObject,
    parents: string[] = [],
  ) {
    if (
      session.status !== "authenticated" ||
      !database.current ||
      !vault.current
    )
      return;
    const now = new Date().toISOString();
    await new ProtectedOfflineRepository(
      database.current,
      vault.current,
    ).commitMutation({
      operation_id: crypto.randomUUID(),
      protocol_version: "sync-v1",
      workspace_id: workspaceId,
      device_id: deviceId,
      entity_type: kind,
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
      payload: { space_id: spaceId, ...payload },
      dependencies: await dependencies(parents),
    });
    await synchronize();
  }
  async function submit(event: FormEvent<HTMLFormElement>, kind: Kind) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      if (kind === "learning_track")
        await commit(kind, {
          title: String(data.get("title")),
          objective: String(data.get("objective")),
        });
      if (kind === "inbox_item")
        await commit(kind, {
          title: String(data.get("title")),
          note: String(data.get("note")),
        });
      if (kind === "study_project") {
        const track = String(data.get("track_id"));
        await commit(
          kind,
          {
            track_id: track,
            title: String(data.get("title")),
            intended_outcome: String(data.get("outcome")),
          },
          [track],
        );
      }
      if (kind === "deliverable") {
        const project = String(data.get("project_id"));
        await commit(
          kind,
          {
            project_id: project,
            title: String(data.get("title")),
            evidence_summary: String(data.get("evidence")),
            completed_at: new Date().toISOString(),
          },
          [project],
        );
      }
      form.reset();
      setStatus("记录已加密保存。");
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }
  async function submitResearch(event: FormEvent<HTMLFormElement>, kind: Kind) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      if (kind === "paper_record")
        await commit(kind, {
          title: String(data.get("title")),
          citation_key: String(data.get("citation_key")),
          source_url: null,
        });
      if (kind === "research_question")
        await commit(kind, {
          question: String(data.get("question")),
          rationale: String(data.get("rationale")),
        });
      if (kind === "research_claim") {
        const parent = String(data.get("paper_id"));
        await commit(
          kind,
          {
            paper_id: parent,
            statement: String(data.get("statement")),
            stance: String(data.get("stance")),
          },
          [parent],
        );
      }
      if (kind === "experiment_run") {
        const parent = String(data.get("question_id"));
        await commit(
          kind,
          {
            question_id: parent,
            title: String(data.get("title")),
            method_summary: String(data.get("method")),
            completed_at: new Date().toISOString(),
          },
          [parent],
        );
      }
      if (kind === "metric_record") {
        const parent = String(data.get("run_id"));
        await commit(
          kind,
          {
            run_id: parent,
            name: String(data.get("name")),
            value: Number(data.get("value")),
            unit: String(data.get("unit")),
          },
          [parent],
        );
      }
      if (kind === "research_feedback") {
        const parent = String(data.get("claim_id"));
        await commit(
          kind,
          {
            claim_id: parent,
            description: String(data.get("description")),
            requested_action: String(data.get("action")),
          },
          [parent],
        );
      }
      form.reset();
      setStatus("研究记录已加密保存。");
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }
  async function submitCollaboration(
    event: FormEvent<HTMLFormElement>,
    kind: Kind,
  ) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      if (kind === "rubric")
        await commit(kind, {
          title: String(data.get("title")),
          criteria: String(data.get("criteria")),
        });
      if (kind === "group_review") {
        const parent = String(data.get("rubric_id"));
        await commit(
          kind,
          {
            rubric_id: parent,
            subject_title: String(data.get("subject_title")),
            submission_summary: String(data.get("summary")),
          },
          [parent],
        );
      }
      if (kind === "group_feedback") {
        const parent = String(data.get("review_id"));
        await commit(
          kind,
          {
            review_id: parent,
            feedback: String(data.get("feedback")),
            recommended_action: String(data.get("action")),
          },
          [parent],
        );
      }
      if (kind === "report_snapshot") {
        const parent = String(data.get("review_id"));
        await commit(
          kind,
          {
            review_id: parent,
            summary: String(data.get("summary")),
            published_at: new Date().toISOString(),
          },
          [parent],
        );
      }
      form.reset();
      setStatus("共享记录已加密保存。");
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }
  const visible = (kind: Kind) =>
    records[kind].filter((x) => x.payload.space_id === spaceId);
  const selectedRole = workspaces.find((x) => x.id === workspaceId)?.role;
  const canPlanShared =
    selectedRole === "owner" ||
    selectedRole === "admin" ||
    selectedRole === "editor";
  const canReviewShared = canPlanShared || selectedRole === "reviewer";
  if (mode === "collaboration")
    return (
      <main id="main-content" className="settings-page today-page">
        <header>
          <p className="eyebrow">LOGION · GROUP</p>
          <h1>导师与小组审阅闭环</h1>
          <p aria-live="polite">{status}</p>
        </header>
        <section className="settings-card">
          <h2>共享空间</h2>
          <div className="inline-form">
            <select
              aria-label="工作区"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              aria-label="共享空间"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              {spaces.every((x) => x.visibility !== "shared") ? (
                <option value="">尚无可用共享空间</option>
              ) : null}
              {spaces
                .filter((x) => x.visibility === "shared")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!unlocked}
              onClick={() => void synchronize()}
            >
              同步
            </button>
          </div>
          <form className="inline-form" onSubmit={unlock}>
            <input
              name="passphrase"
              type="password"
              minLength={10}
              autoComplete="current-password"
              aria-label="本地口令"
              required
            />
            <button>解锁</button>
          </form>
        </section>
        <section className="settings-card">
          <h2>Rubric 与审阅</h2>
          {!canPlanShared ? (
            <p role="status">
              当前角色可查看共享内容，但不能修改 Rubric、审阅或报告。
            </p>
          ) : null}
          <form
            className="planning-form"
            onSubmit={(e) => submitCollaboration(e, "rubric")}
          >
            <input name="title" placeholder="Rubric 名称" required />
            <textarea name="criteria" placeholder="验收标准" required />
            <button disabled={!unlocked || !spaceId || !canPlanShared}>
              创建 Rubric
            </button>
          </form>
          <form
            className="planning-form"
            onSubmit={(e) => submitCollaboration(e, "group_review")}
          >
            <select name="rubric_id" required>
              <option value="">选择 Rubric</option>
              {visible("rubric").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.title)}
                </option>
              ))}
            </select>
            <input name="subject_title" placeholder="审阅对象" required />
            <textarea
              name="summary"
              placeholder="提交摘要（仅共享内容）"
              required
            />
            <button disabled={!unlocked || !spaceId || !canPlanShared}>
              发起审阅
            </button>
          </form>
        </section>
        <section className="settings-card">
          <h2>反馈与报告快照</h2>
          <form
            className="planning-form"
            onSubmit={(e) => submitCollaboration(e, "group_feedback")}
          >
            <select name="review_id" required>
              <option value="">选择审阅</option>
              {visible("group_review").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.subject_title)}
                </option>
              ))}
            </select>
            <textarea name="feedback" placeholder="反馈" required />
            <textarea name="action" placeholder="建议动作" />
            <button disabled={!unlocked || !spaceId || !canReviewShared}>
              提交反馈
            </button>
          </form>
          <form
            className="planning-form"
            onSubmit={(e) => submitCollaboration(e, "report_snapshot")}
          >
            <select name="review_id" required>
              <option value="">选择审阅</option>
              {visible("group_review").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.subject_title)}
                </option>
              ))}
            </select>
            <textarea name="summary" placeholder="只读报告摘要" required />
            <button disabled={!unlocked || !spaceId || !canPlanShared}>
              发布不可变快照
            </button>
          </form>
          <div className="task-grid">
            {visible("group_review").map((review) => (
              <article className="task-card" key={review.entity.entity_id}>
                <h3>{String(review.payload.subject_title)}</h3>
                {visible("group_feedback")
                  .filter(
                    (x) => x.payload.review_id === review.entity.entity_id,
                  )
                  .map((x) => (
                    <p key={x.entity.entity_id}>{String(x.payload.feedback)}</p>
                  ))}
                {visible("report_snapshot")
                  .filter(
                    (x) => x.payload.review_id === review.entity.entity_id,
                  )
                  .map((x) => (
                    <p key={x.entity.entity_id}>
                      报告：{String(x.payload.summary)}
                    </p>
                  ))}
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  if (mode === "research")
    return (
      <main id="main-content" className="settings-page today-page">
        <header>
          <p className="eyebrow">LOGION · RESEARCH</p>
          <h1>研究证据与实验闭环</h1>
          <p aria-live="polite">{status}</p>
        </header>
        <section className="settings-card">
          <h2>研究空间</h2>
          <div className="inline-form">
            <select
              aria-label="工作区"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              aria-label="空间"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              {spaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!unlocked}
              onClick={() => void synchronize()}
            >
              同步
            </button>
          </div>
          <form className="inline-form" onSubmit={unlock}>
            <input
              name="passphrase"
              type="password"
              minLength={10}
              autoComplete="current-password"
              aria-label="本地口令"
              required
            />
            <button>解锁</button>
          </form>
        </section>
        <section className="settings-card">
          <h2>论文与声明</h2>
          <form
            className="planning-form"
            onSubmit={(e) => submitResearch(e, "paper_record")}
          >
            <input name="title" placeholder="论文标题" required />
            <input name="citation_key" placeholder="引用键" required />
            <button disabled={!unlocked}>保存论文索引</button>
          </form>
          <form
            className="planning-form"
            onSubmit={(e) => submitResearch(e, "research_claim")}
          >
            <select name="paper_id" required>
              <option value="">选择论文</option>
              {visible("paper_record").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.title)}
                </option>
              ))}
            </select>
            <textarea name="statement" placeholder="研究声明" required />
            <select name="stance">
              <option value="supports">支持</option>
              <option value="opposes">反对</option>
              <option value="mixed">混合</option>
              <option value="unknown">未判断</option>
            </select>
            <button disabled={!unlocked}>记录声明证据</button>
          </form>
        </section>
        <section className="settings-card">
          <h2>问题与实验</h2>
          <form
            className="planning-form"
            onSubmit={(e) => submitResearch(e, "research_question")}
          >
            <textarea name="question" placeholder="研究问题" required />
            <textarea name="rationale" placeholder="问题依据" />
            <button disabled={!unlocked}>创建问题</button>
          </form>
          <form
            className="planning-form"
            onSubmit={(e) => submitResearch(e, "experiment_run")}
          >
            <select name="question_id" required>
              <option value="">选择问题</option>
              {visible("research_question").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.question)}
                </option>
              ))}
            </select>
            <input name="title" placeholder="实验运行名称" required />
            <textarea name="method" placeholder="方法摘要" required />
            <button disabled={!unlocked}>记录已完成运行</button>
          </form>
        </section>
        <section className="settings-card">
          <h2>指标与反馈</h2>
          <form
            className="planning-form"
            onSubmit={(e) => submitResearch(e, "metric_record")}
          >
            <select name="run_id" required>
              <option value="">选择运行</option>
              {visible("experiment_run").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.title)}
                </option>
              ))}
            </select>
            <input name="name" placeholder="指标名称" required />
            <input
              name="value"
              type="number"
              step="any"
              placeholder="数值"
              required
            />
            <input name="unit" placeholder="单位" />
            <button disabled={!unlocked}>追加指标</button>
          </form>
          <form
            className="planning-form"
            onSubmit={(e) => submitResearch(e, "research_feedback")}
          >
            <select name="claim_id" required>
              <option value="">选择声明</option>
              {visible("research_claim").map((x) => (
                <option key={x.entity.entity_id} value={x.entity.entity_id}>
                  {String(x.payload.statement)}
                </option>
              ))}
            </select>
            <textarea name="description" placeholder="反馈" required />
            <textarea name="action" placeholder="建议动作" />
            <button disabled={!unlocked}>记录反馈</button>
          </form>
          <div className="task-grid">
            {visible("experiment_run").map((run) => (
              <article className="task-card" key={run.entity.entity_id}>
                <h3>{String(run.payload.title)}</h3>
                {visible("metric_record")
                  .filter((m) => m.payload.run_id === run.entity.entity_id)
                  .map((m) => (
                    <p key={m.entity.entity_id}>
                      {String(m.payload.name)}：{String(m.payload.value)}{" "}
                      {String(m.payload.unit)}
                    </p>
                  ))}
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  return (
    <main id="main-content" className="settings-page today-page">
      <header>
        <p className="eyebrow">LOGION · SELF STUDY</p>
        <h1>自主学习闭环</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <h2>学习空间</h2>
        <div className="inline-form">
          <select
            aria-label="工作区"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {workspaces.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            aria-label="空间"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          >
            {spaces.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!unlocked}
            onClick={() => void synchronize()}
          >
            同步
          </button>
        </div>
        <form className="inline-form" onSubmit={unlock}>
          <input
            name="passphrase"
            type="password"
            minLength={10}
            autoComplete="current-password"
            aria-label="本地口令"
            required
          />
          <button>解锁</button>
        </form>
      </section>
      <section className="settings-card">
        <h2>快速收件箱</h2>
        <form
          className="planning-form"
          onSubmit={(e) => submit(e, "inbox_item")}
        >
          <input
            name="title"
            placeholder="想法或资料标题"
            maxLength={160}
            required
          />
          <textarea name="note" placeholder="备注" maxLength={20000} />
          <button disabled={!unlocked}>加密收集</button>
        </form>
        {visible("inbox_item").map((x) => (
          <p key={x.entity.entity_id}>{String(x.payload.title)}</p>
        ))}
      </section>
      <section className="settings-card">
        <h2>学习路线与项目</h2>
        <form
          className="planning-form"
          onSubmit={(e) => submit(e, "learning_track")}
        >
          <input name="title" placeholder="路线名称" required />
          <textarea name="objective" placeholder="目标" />
          <button disabled={!unlocked}>创建路线</button>
        </form>
        <form
          className="planning-form"
          onSubmit={(e) => submit(e, "study_project")}
        >
          <select name="track_id" required>
            <option value="">选择路线</option>
            {visible("learning_track").map((x) => (
              <option key={x.entity.entity_id} value={x.entity.entity_id}>
                {String(x.payload.title)}
              </option>
            ))}
          </select>
          <input name="title" placeholder="项目名称" required />
          <textarea name="outcome" placeholder="预期成果" required />
          <button disabled={!unlocked}>创建项目</button>
        </form>
      </section>
      <section className="settings-card">
        <h2>成果证据</h2>
        <form
          className="planning-form"
          onSubmit={(e) => submit(e, "deliverable")}
        >
          <select name="project_id" required>
            <option value="">选择项目</option>
            {visible("study_project").map((x) => (
              <option key={x.entity.entity_id} value={x.entity.entity_id}>
                {String(x.payload.title)}
              </option>
            ))}
          </select>
          <input name="title" placeholder="成果名称" required />
          <textarea name="evidence" placeholder="完成证据摘要" required />
          <button disabled={!unlocked}>记录已完成成果</button>
        </form>
        <div className="task-grid">
          {visible("learning_track").map((track) => (
            <article className="task-card" key={track.entity.entity_id}>
              <h3>{String(track.payload.title)}</h3>
              <p>{String(track.payload.objective)}</p>
              {visible("study_project")
                .filter((p) => p.payload.track_id === track.entity.entity_id)
                .map((project) => (
                  <section key={project.entity.entity_id}>
                    <h4>{String(project.payload.title)}</h4>
                    {visible("deliverable")
                      .filter(
                        (d) =>
                          d.payload.project_id === project.entity.entity_id,
                      )
                      .map((d) => (
                        <p key={d.entity.entity_id}>
                          ✓ {String(d.payload.title)}
                        </p>
                      ))}
                  </section>
                ))}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
