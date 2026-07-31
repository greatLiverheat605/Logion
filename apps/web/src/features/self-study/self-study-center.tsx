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
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ProductBarChart,
  ProductDisclosure,
  ProductEmptyState,
  ProductHero,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductProgress,
  ProductTag,
  ProductTaskRow,
} from "@/components/product/product-ui";
import {
  deriveProductWorkbenchState,
  ProductWorkbenchStateNotice,
} from "@/components/product/product-workbench-state";
import { AppIcon } from "@/components/app-shell/app-icon";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { eligibleCollaborationSpaces } from "./collaboration-workbench-model";
import { ResearchExperimentComparison } from "./research-experiment-comparison";
import {
  buildMetricComparison,
  researchQuestionCoverage,
} from "./research-workbench-model";
import { buildSelfStudySummary } from "./self-study-workbench-model";

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

function safeResearchUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
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
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState(""),
    [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const unlocked = vaultPhase === "unlocked";
  const [status, setStatus] = useState(() =>
    mode === "collaboration"
      ? "正在准备共享审阅空间……"
      : mode === "research"
        ? "正在准备研究空间……"
        : "正在准备自主学习空间……",
  );
  const [researchQuery, setResearchQuery] = useState("");
  const [selectedPaperId, setSelectedPaperId] = useState("");
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
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const loadContext = useCallback(async () => {
    setContextPhase("loading");
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
      setContextPhase("ready");
    } catch (error) {
      setStatus(errorMessage(error));
      setContextPhase("error");
    }
  }, [mode]);
  const loadSpaces = useCallback(
    async (id: string) => {
      setContextPhase("loading");
      try {
        const r = await browserApiClient.request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${id}/spaces`,
        );
        setSpaces(r.spaces);
        const eligible =
          mode === "collaboration"
            ? eligibleCollaborationSpaces(r.spaces)
            : r.spaces;
        setSpaceId((current) =>
          eligible.some((space) => space.id === current)
            ? current
            : (eligible[0]?.id ?? ""),
        );
        setContextPhase("ready");
      } catch (error) {
        setSpaces([]);
        setSpaceId("");
        setStatus(errorMessage(error));
        setContextPhase("error");
      }
    },
    [mode],
  );
  useEffect(() => {
    queueMicrotask(() => void loadContext());
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
    setDataPhase("loading");
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
    setDataPhase("ready");
  }
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId) return;
    try {
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase") ?? "",
      );
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus("资料已在应用内解锁，可断网编辑并稍后同步。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(errorMessage(error));
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
            setStatus(
              mode === "collaboration"
                ? "共享审阅资料已在应用内解锁。"
                : mode === "research"
                  ? "研究资料已在应用内解锁。"
                  : "自主学习资料已在应用内解锁。",
            ),
          )
          .catch((error: unknown) => {
            setDataPhase("error");
            setStatus(errorMessage(error));
          }),
    );
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, unlocked, vaultRevision, workspaceId]);
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
          source_url: String(data.get("source_url") ?? "") || null,
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
    if (spaces.find((space) => space.id === spaceId)?.visibility !== "shared") {
      setStatus("协作审阅只能写入当前账号有权访问的共享 Space。");
      return;
    }
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
  const researchPapers = visible("paper_record");
  const normalizedResearchQuery = researchQuery.trim().toLocaleLowerCase();
  const filteredResearchPapers = researchPapers.filter((paper) =>
    [paper.payload.title, paper.payload.citation_key].some((value) =>
      String(value ?? "")
        .toLocaleLowerCase()
        .includes(normalizedResearchQuery),
    ),
  );
  const selectedPaper =
    filteredResearchPapers.find(
      (paper) => paper.entity.entity_id === selectedPaperId,
    ) ?? filteredResearchPapers[0];
  const researchQuestions = visible("research_question");
  const researchRuns = visible("experiment_run");
  const researchMetrics = visible("metric_record");
  const researchCoverage = researchQuestionCoverage(
    researchQuestions.map((item) => item.entity.entity_id),
    researchRuns.map((item) => ({
      id: item.entity.entity_id,
      parentId: String(item.payload.question_id ?? "") || null,
    })),
  );
  const metricComparison = buildMetricComparison(
    researchRuns.map((item) => ({
      id: item.entity.entity_id,
      title: String(item.payload.title),
    })),
    researchMetrics.map((item) => ({
      id: item.entity.entity_id,
      name: String(item.payload.name),
      runId: String(item.payload.run_id),
      unit: String(item.payload.unit ?? ""),
      value: Number(item.payload.value),
    })),
  );
  const selectedRole = workspaces.find((x) => x.id === workspaceId)?.role;
  const canPlanShared =
    selectedRole === "owner" ||
    selectedRole === "admin" ||
    selectedRole === "editor";
  const canReviewShared = canPlanShared || selectedRole === "reviewer";
  const collaborationRecords = [
    ...visible("rubric"),
    ...visible("group_review"),
    ...visible("group_feedback"),
    ...visible("report_snapshot"),
  ];
  const collaborationState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(
      workspaceId &&
      spaceId &&
      spaces.find((space) => space.id === spaceId)?.visibility === "shared",
    ),
    hasData: collaborationRecords.length > 0,
    stale: collaborationRecords.some(
      (item) => item.entity.sync_status !== "clean",
    ),
    unlocked,
  });
  const researchRecords = [
    ...researchPapers,
    ...visible("research_claim"),
    ...researchQuestions,
    ...researchRuns,
    ...researchMetrics,
    ...visible("research_feedback"),
  ];
  const researchState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(workspaceId && spaceId),
    hasData: researchRecords.length > 0,
    stale: researchRecords.some((item) => item.entity.sync_status !== "clean"),
    unlocked,
  });
  const selfStudyRecords = [
    ...visible("learning_track"),
    ...visible("study_project"),
    ...visible("inbox_item"),
    ...visible("deliverable"),
  ];
  const selfStudySummary = buildSelfStudySummary({
    tracks: visible("learning_track").map((item) => ({
      id: item.entity.entity_id,
    })),
    projects: visible("study_project").map((item) => ({
      id: item.entity.entity_id,
      parentId: String(item.payload.track_id ?? "") || null,
    })),
    deliverables: visible("deliverable").map((item) => ({
      id: item.entity.entity_id,
      parentId: String(item.payload.project_id ?? "") || null,
    })),
  });
  const selfStudyState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(workspaceId && spaceId),
    hasData: selfStudyRecords.length > 0,
    stale: selfStudyRecords.some((item) => item.entity.sync_status !== "clean"),
    unlocked,
  });
  const contextControls = (
    <ProductDisclosure
      summary={
        mode === "collaboration"
          ? "共享空间与本地资料"
          : mode === "research"
            ? "研究空间与本地资料"
            : "学习空间与本地资料"
      }
      description="选择工作区、空间并解锁端侧加密内容"
      defaultOpen={!unlocked}
    >
      <div className="inline-form">
        <label>
          工作区
          <select
            aria-label="工作区"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {mode === "collaboration" ? "共享空间" : "空间"}
          <select
            aria-label={mode === "collaboration" ? "共享空间" : "空间"}
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            {mode === "collaboration" &&
            spaces.every((space) => space.visibility !== "shared") ? (
              <option value="">尚无可用共享空间</option>
            ) : null}
            {spaces
              .filter(
                (space) =>
                  mode !== "collaboration" || space.visibility === "shared",
              )
              .map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => void synchronize()}
        >
          立即同步
        </button>
      </div>
      <form className="inline-form" onSubmit={unlock}>
        <label>
          本地口令
          <input
            name="passphrase"
            type="password"
            minLength={10}
            autoComplete="current-password"
            required
          />
        </label>
        <button>{unlocked ? "重新解锁" : "解锁资料"}</button>
      </form>
    </ProductDisclosure>
  );
  if (mode === "collaboration")
    return (
      <main id="main-content" className="settings-page today-page">
        <ProductPageHeader
          eyebrow="COLLABORATION · SMALL GROUP REVIEW"
          title="让反馈落到共享对象和下一步行动"
          description={
            <>
              <p>
                面向最多 10
                人的小组协作；私人笔记、错题与未提交草稿始终不进入共享视图。
              </p>
              <p className="product-page-status" aria-live="polite">
                {status}
              </p>
            </>
          }
        />
        <ProductWorkbenchStateNotice
          action={
            collaborationState === "locked" ? (
              <a className="product-action-link" href="#collaboration-context">
                解锁本地资料
              </a>
            ) : (
              <a className="product-action-link" href="#collaboration-context">
                选择共享 Space
              </a>
            )
          }
          emptyDescription="共享 Space 已就绪；创建 Rubric 后才能发起可追溯审阅。"
          emptyTitle="当前共享 Space 还没有审阅"
          onRetry={() => void loadContext()}
          state={collaborationState}
        />
        <ProductHero
          badge={<ProductTag tone="info">最多 10 人协作</ProductTag>}
          title={
            visible("group_review").at(-1)?.payload.subject_title
              ? String(visible("group_review").at(-1)?.payload.subject_title)
              : "从统一验收标准开始一次审阅"
          }
          progressLabel="审阅快照覆盖"
          progressValue={
            visible("group_review").length
              ? (visible("report_snapshot").length /
                  visible("group_review").length) *
                100
              : 0
          }
        >
          用 Rubric
          对齐判断标准，集中收集小组反馈，并在确认后发布不可变报告快照。
        </ProductHero>
        <div className="product-metric-grid">
          <ProductMetric
            label="Rubric"
            value={visible("rubric").length}
            detail="共享验收标准"
          />
          <ProductMetric
            label="审阅"
            value={visible("group_review").length}
            detail="当前共享空间"
            tone="info"
          />
          <ProductMetric
            label="反馈"
            value={visible("group_feedback").length}
            detail="成员提交记录"
            tone="good"
          />
          <ProductMetric
            label="报告快照"
            value={visible("report_snapshot").length}
            detail="不可变结果"
          />
        </div>
        <div id="collaboration-context">{contextControls}</div>

        <ProductDisclosure
          summary="配置 Rubric 并发起审阅"
          description="仅现有 owner、admin、editor 角色可执行"
        >
          {!canPlanShared ? (
            <p role="status">
              当前角色可查看共享内容，但不能修改 Rubric、审阅或报告。
            </p>
          ) : null}
          <div className="product-config-grid">
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
          </div>
        </ProductDisclosure>

        <ProductPanel
          title="反馈与报告快照"
          description="审阅者提交反馈；有规划权限的成员发布最终快照。"
          aside={
            <ProductTag tone="info">
              {visible("group_review").length} 项审阅
            </ProductTag>
          }
        >
          <div className="product-config-grid">
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
          </div>
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
            {visible("group_review").length === 0 ? (
              <ProductEmptyState
                icon="◇"
                title="还没有共享审阅"
                description="先创建 Rubric，再选择一个学习成果发起审阅。"
              />
            ) : null}
          </div>
        </ProductPanel>
      </main>
    );
  if (mode === "research")
    return (
      <main id="main-content" className="settings-page today-page">
        <ProductPageHeader
          eyebrow="RESEARCH · EVIDENCE WORKBENCH"
          title="论文研读与证据工作台"
          description={
            <>
              <p>把论文、声明、研究问题、实验和指标放进同一条可追溯证据链。</p>
              <p className="product-page-status" aria-live="polite">
                {status}
              </p>
            </>
          }
        />
        <ProductWorkbenchStateNotice
          action={
            researchState === "locked" ? (
              <a className="product-action-link" href="#research-context">
                解锁本地资料
              </a>
            ) : (
              <a className="product-action-link" href="#research-context">
                选择研究 Space
              </a>
            )
          }
          emptyDescription="当前 Space 尚无论文、声明、问题或运行；先登记可信来源。"
          emptyTitle="当前 Space 还没有研究记录"
          onRetry={() => void loadContext()}
          state={researchState}
        />
        <div id="research-context">{contextControls}</div>

        <section className="product-research-summary" aria-label="研究证据概览">
          <article>
            <span>论文</span>
            <strong>{researchPapers.length}</strong>
            <small>{visible("research_claim").length} 条声明</small>
          </article>
          <article>
            <span>问题</span>
            <strong>{visible("research_question").length}</strong>
            <small>待证据回答</small>
          </article>
          <article>
            <span>实验</span>
            <strong>{visible("experiment_run").length}</strong>
            <small>{visible("metric_record").length} 条指标</small>
          </article>
          <article>
            <span>反馈</span>
            <strong>{visible("research_feedback").length}</strong>
            <small>声明改进记录</small>
          </article>
        </section>

        <section className="product-toolbar" aria-label="论文筛选">
          <label className="product-search-field" htmlFor="research-search">
            <AppIcon name="search" size={17} />
            <input
              aria-label="搜索论文"
              id="research-search"
              type="search"
              value={researchQuery}
              placeholder="搜索论文标题或引用键"
              onChange={(event) => setResearchQuery(event.target.value)}
            />
          </label>
          <ProductTag tone={unlocked ? "good" : "warn"}>
            {unlocked ? "本地证据库已解锁" : "等待本地解锁"}
          </ProductTag>
        </section>

        <div className="product-research-workbench">
          <ProductPanel
            className="product-research-library"
            title="论文库"
            description="选择来源查看关联声明。"
            aside={<ProductTag>{filteredResearchPapers.length} 篇</ProductTag>}
          >
            <div className="product-paper-list">
              {filteredResearchPapers.map((paper) => (
                <button
                  aria-pressed={
                    selectedPaper?.entity.entity_id === paper.entity.entity_id
                  }
                  className={
                    selectedPaper?.entity.entity_id === paper.entity.entity_id
                      ? "product-paper-row selected"
                      : "product-paper-row"
                  }
                  key={paper.entity.entity_id}
                  type="button"
                  onClick={() => setSelectedPaperId(paper.entity.entity_id)}
                >
                  <AppIcon name="files" size={17} />
                  <span>
                    <strong>{String(paper.payload.title)}</strong>
                    <small>{String(paper.payload.citation_key)}</small>
                  </span>
                </button>
              ))}
              {filteredResearchPapers.length === 0 ? (
                <ProductEmptyState
                  icon="◇"
                  title={
                    researchPapers.length ? "没有匹配论文" : "尚未登记论文"
                  }
                  description={
                    researchPapers.length
                      ? "尝试使用更短的标题或引用键。"
                      : "从下方登记第一篇论文索引，建立证据来源。"
                  }
                />
              ) : null}
            </div>
          </ProductPanel>

          <ProductPanel
            className="product-research-reader"
            title="研读画布"
            description="先确认来源，再审阅关联声明与当前研究问题。"
          >
            {selectedPaper ? (
              <div className="product-reader-body">
                <div className="product-reader-title">
                  <span aria-hidden="true">
                    <AppIcon name="book-open" size={22} />
                  </span>
                  <div>
                    <ProductTag tone="info">
                      {String(selectedPaper.payload.citation_key)}
                    </ProductTag>
                    <h2>{String(selectedPaper.payload.title)}</h2>
                  </div>
                </div>
                <section className="product-reader-question">
                  <span>当前研究问题</span>
                  <strong>
                    {visible("research_question").at(-1)?.payload.question
                      ? String(
                          visible("research_question").at(-1)?.payload.question,
                        )
                      : "尚未创建研究问题"}
                  </strong>
                </section>
                <section className="product-reader-question">
                  <span>正文来源</span>
                  {safeResearchUrl(selectedPaper.payload.source_url) ? (
                    <a
                      href={
                        safeResearchUrl(selectedPaper.payload.source_url) ??
                        undefined
                      }
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      打开论文外部来源
                    </a>
                  ) : (
                    <strong>尚未登记来源地址</strong>
                  )}
                  <small>
                    当前契约只保存来源索引；正文不复制进本地，结构化声明作为可追溯标注回流。
                  </small>
                </section>
                <div className="product-reader-claims">
                  <h3>关联声明</h3>
                  {visible("research_claim")
                    .filter(
                      (claim) =>
                        claim.payload.paper_id ===
                        selectedPaper.entity.entity_id,
                    )
                    .map((claim) => (
                      <article key={claim.entity.entity_id}>
                        <ProductTag>
                          {String(claim.payload.stance ?? "unknown")}
                        </ProductTag>
                        <p>{String(claim.payload.statement)}</p>
                      </article>
                    ))}
                  {visible("research_claim").every(
                    (claim) =>
                      claim.payload.paper_id !== selectedPaper.entity.entity_id,
                  ) ? (
                    <p className="product-muted-note">
                      这篇论文还没有关联声明。
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <ProductEmptyState
                icon="◇"
                title="选择一篇论文"
                description="论文的研究问题和关联声明会在这里集中呈现。"
              />
            )}
          </ProductPanel>

          <ProductPanel
            className="product-research-evidence"
            title="证据进度"
            description="检查研究链路是否从来源走到验证。"
          >
            {researchCoverage === null ? (
              <p className="product-muted-note">
                创建研究问题后再计算有真实运行覆盖的问题比例。
              </p>
            ) : (
              <ProductProgress
                label="问题实验覆盖率"
                value={researchCoverage}
                tone="good"
              />
            )}
            <ProductBarChart
              label="研究证据链数量"
              items={[
                { label: "论文", value: researchPapers.length },
                { label: "声明", value: visible("research_claim").length },
                { label: "问题", value: visible("research_question").length },
                { label: "实验", value: visible("experiment_run").length },
                { label: "指标", value: visible("metric_record").length },
              ]}
            />
            <div className="product-task-list">
              <ProductTaskRow
                icon="1"
                title="来源"
                description={`${researchPapers.length} 篇论文`}
              />
              <ProductTaskRow
                icon="2"
                title="声明"
                description={`${visible("research_claim").length} 条证据`}
              />
              <ProductTaskRow
                icon="3"
                title="验证"
                description={`${visible("experiment_run").length} 次运行`}
              />
            </div>
          </ProductPanel>
        </div>
        <ProductDisclosure
          summary="登记论文与研究声明"
          description="声明必须关联已有论文来源"
        >
          <div className="product-config-grid">
            <form
              className="planning-form"
              onSubmit={(e) => submitResearch(e, "paper_record")}
            >
              <input name="title" placeholder="论文标题" required />
              <input name="citation_key" placeholder="引用键" required />
              <input
                name="source_url"
                type="url"
                placeholder="论文来源 URL（可选）"
              />
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
          </div>
        </ProductDisclosure>
        <ProductDisclosure
          summary="创建问题与实验运行"
          description="先定义问题，再记录方法和已完成运行"
        >
          <div className="product-config-grid">
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
          </div>
        </ProductDisclosure>
        <ProductPanel
          title="指标与反馈"
          description="为实验追加真实指标，并把反馈关联到研究声明。"
          aside={
            <ProductTag tone="info">
              {visible("metric_record").length} 条指标
            </ProductTag>
          }
        >
          <div className="product-config-grid">
            <form
              className="planning-form"
              onSubmit={(e) => submitResearch(e, "metric_record")}
            >
              <select aria-label="选择实验运行" name="run_id" required>
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
              <select aria-label="选择研究声明" name="claim_id" required>
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
          </div>
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
            {visible("experiment_run").length === 0 ? (
              <ProductEmptyState
                icon="⌁"
                title="尚无实验运行"
                description="创建研究问题并记录第一项实验方法后，指标会在这里聚合。"
              />
            ) : null}
          </div>
        </ProductPanel>
        <ProductPanel
          title="实验指标比较"
          description="只并列同名、同单位且关联真实运行的有限数值；不自动换算或推断优劣。"
        >
          <ResearchExperimentComparison comparison={metricComparison} />
        </ProductPanel>
      </main>
    );
  return (
    <main id="main-content" className="settings-page today-page">
      <ProductPageHeader
        eyebrow="SELF STUDY · PROJECT-BASED LEARNING"
        title="用可运行成果推动自主学习"
        description={
          <>
            <p>
              课程只是资料来源；真正的主线是项目里程碑、能力缺口和可验证产出。
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
      />
      <ProductWorkbenchStateNotice
        action={
          selfStudyState === "locked" ? (
            <a className="product-action-link" href="#self-study-context">
              解锁本地资料
            </a>
          ) : selfStudyState === "empty" ? (
            <a
              className="product-action-link primary"
              href="#self-study-create"
            >
              创建第一条路线
            </a>
          ) : (
            <a className="product-action-link" href="#self-study-context">
              选择工作区与 Space
            </a>
          )
        }
        emptyDescription="当前 Space 尚无收件箱、路线、项目或成果；先创建路线，再建立可交付项目。"
        emptyTitle="当前 Space 还没有自主学习记录"
        onRetry={() => void loadContext()}
        state={selfStudyState}
      />
      <ProductHero
        badge={<ProductTag tone="info">学习项目工作台</ProductTag>}
        title={
          visible("study_project").at(-1)?.payload.title
            ? String(visible("study_project").at(-1)?.payload.title)
            : "建立一条围绕成果的学习路线"
        }
        progressLabel={
          selfStudySummary.projectCoverage === null ? undefined : "项目成果覆盖"
        }
        progressValue={selfStudySummary.projectCoverage ?? undefined}
      >
        快速收集想法，把它们组织为路线与项目，最终用真实成果证明学习已经发生。
      </ProductHero>
      <div className="product-metric-grid">
        <ProductMetric
          label="收件箱"
          value={visible("inbox_item").length}
          detail="待整理想法与资料"
          tone="warn"
        />
        <ProductMetric
          label="学习路线"
          value={selfStudySummary.trackCount}
          detail="长期主题"
          tone="info"
        />
        <ProductMetric
          label="进行项目"
          value={selfStudySummary.projectCount}
          detail={
            selfStudySummary.orphanProjectCount
              ? `${selfStudySummary.orphanProjectCount} 个项目缺少有效路线`
              : "成果驱动"
          }
        />
        <ProductMetric
          label="成果证据"
          value={selfStudySummary.deliverableCount}
          detail="已完成记录"
          tone="good"
        />
      </div>
      <div id="self-study-context">{contextControls}</div>

      <div className="product-dashboard-grid product-dashboard-grid-wide">
        <ProductPanel
          title="快速收件箱"
          description="先无压力捕获，再决定是否进入正式路线。"
          aside={
            <ProductTag tone="warn">
              {visible("inbox_item").length} 项待整理
            </ProductTag>
          }
        >
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
            <ProductTaskRow
              key={x.entity.entity_id}
              icon="＋"
              title={String(x.payload.title)}
              description={String(x.payload.note || "暂无备注")}
            />
          ))}
          {visible("inbox_item").length === 0 ? (
            <ProductEmptyState
              icon="＋"
              title="收件箱已清空"
              description="发现值得继续探索的想法时，先快速收集到这里。"
            />
          ) : null}
        </ProductPanel>
        <ProductPanel title="学习漏斗" description="从收集到成果的真实记录数量">
          <ProductBarChart
            label="自主学习阶段数量"
            items={[
              { label: "收集", value: visible("inbox_item").length },
              { label: "路线", value: visible("learning_track").length },
              { label: "项目", value: visible("study_project").length },
              { label: "成果", value: visible("deliverable").length },
            ]}
          />
        </ProductPanel>
      </div>

      <ProductDisclosure
        id="self-study-create"
        summary="创建学习路线与项目"
        description="路线定义长期方向，项目定义可交付成果"
      >
        <div className="product-config-grid">
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
        </div>
      </ProductDisclosure>

      <ProductPanel
        title="路线、项目与成果证据"
        description="沿路线查看项目，并确认每个项目留下了什么成果。"
        aside={
          <ProductTag tone="good">
            {visible("deliverable").length} 项成果
          </ProductTag>
        }
      >
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
          {visible("learning_track").length === 0 ? (
            <ProductEmptyState
              icon="◎"
              title="还没有学习路线"
              description="创建一条路线，并用一个能够展示的项目作为起点。"
            />
          ) : null}
        </div>
      </ProductPanel>
    </main>
  );
}
