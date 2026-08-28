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
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { deriveProductWorkbenchState } from "@/components/product/product-workbench-state";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { LogionApiError, type ApiClient } from "@/lib/api/client";

import { eligibleCollaborationSpaces } from "./collaboration-workbench-model";
import {
  buildMetricComparison,
  researchQuestionCoverage,
} from "./research-workbench-model";
import { buildSelfStudySummary } from "./self-study-workbench-model";
import {
  SelfStudyWorkbench,
  type SelfStudyKind,
  type SelfStudyWorkbenchData,
} from "./self-study-workbench";
import {
  ResearchWorkbench,
  type ResearchWorkbenchData,
} from "./research-workbench";
import {
  CollaborationWorkbench,
  type CollaborationWorkbenchData,
} from "./collaboration-workbench";
import {
  safeResearchSourceUrl,
  type CollaborationEntityType,
  type ResearchEntityType,
} from "./research-collaboration-contract";
import { useSelfStudyController } from "./use-self-study-controller";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type ContextSelection = { spaceId: string; workspaceId: string };
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

function transport(
  apiRequest: ApiClient["request"],
  workspaceId: string,
): SyncTransport {
  return {
    push: (syncRequest) =>
      apiRequest(`/api/v1/workspaces/${workspaceId}/sync/push`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify(syncRequest),
      }),
    pull: (syncRequest) =>
      apiRequest(`/api/v1/workspaces/${workspaceId}/sync/pull`, {
        method: "POST",
        body: JSON.stringify(syncRequest),
      }),
  };
}
function errorMessage(error: unknown) {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）。`
    : "网络暂不可用；内容仍保存在本机 Outbox。";
}

function contextSelectionKey(
  mode: "self-study" | "research" | "collaboration",
) {
  return `logion:workbench-context:${mode}`;
}

function readContextSelection(
  mode: "self-study" | "research" | "collaboration",
): ContextSelection {
  if (typeof window === "undefined") return { spaceId: "", workspaceId: "" };
  try {
    const raw = window.sessionStorage.getItem(contextSelectionKey(mode));
    if (!raw) return { spaceId: "", workspaceId: "" };
    const parsed = JSON.parse(raw) as Partial<ContextSelection>;
    return {
      spaceId: typeof parsed.spaceId === "string" ? parsed.spaceId : "",
      workspaceId:
        typeof parsed.workspaceId === "string" ? parsed.workspaceId : "",
    };
  } catch {
    return { spaceId: "", workspaceId: "" };
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
  const { request } = useSelfStudyController();
  const { state: session } = useSession();
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const [initialSelection] = useState(() => readContextSelection(mode));
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState(initialSelection.workspaceId),
    [spaceId, setSpaceId] = useState(initialSelection.spaceId);
  const spacesRequestRef = useRef(0);
  const [deviceId, setDeviceId] = useState("");
  const unlocked = vaultPhase === "unlocked";
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
        request<{ workspaces: Workspace[] }>("/api/v1/workspaces"),
        request<{ devices: Device[] }>("/api/v1/auth/devices"),
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
  }, [mode, request]);
  const loadSpaces = useCallback(
    async (id: string) => {
      const requestId = ++spacesRequestRef.current;
      setContextPhase("loading");
      try {
        const r = await request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${id}/spaces`,
        );
        // A workspace can trigger overlapping loads (for example during a
        // reload while the previous context request is still settling). An
        // older response must not overwrite a Space selected from a newer
        // response.
        if (requestId !== spacesRequestRef.current) return;
        setSpaces(r.spaces);
        const eligible =
          mode === "collaboration"
            ? eligibleCollaborationSpaces(r.spaces)
            : r.spaces;
        setSpaceId((current) => {
          return eligible.some((space) => space.id === current)
            ? current
            : (eligible[0]?.id ?? "");
        });
        setContextPhase("ready");
      } catch (error) {
        if (requestId !== spacesRequestRef.current) return;
        setSpaces([]);
        setSpaceId("");
        setStatus(errorMessage(error));
        setContextPhase("error");
      }
    },
    [mode, request],
  );
  useEffect(() => {
    queueMicrotask(() => void loadContext());
  }, [loadContext]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        contextSelectionKey(mode),
        JSON.stringify({ spaceId, workspaceId }),
      );
    } catch {
      // Session storage is an optional continuity aid; context loading remains authoritative.
    }
  }, [mode, spaceId, workspaceId]);
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
      request<unknown>(`/api/v1/workspaces/${workspaceId}/sync/bootstrap`, {
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
      });
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
  async function unlock(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId)
      return false;
    try {
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase") ?? "",
      );
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus("资料已在应用内解锁，可断网编辑并稍后同步。");
      event.currentTarget.reset();
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      return false;
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
        transport(request, workspaceId),
        vault.current,
      ).synchronize(workspaceId, deviceId);
      setStatus(
        mode === "collaboration"
          ? "共享审阅资料已同步。"
          : mode === "research"
            ? "研究资料已同步。"
            : "自主学习资料已同步。",
      );
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
  ): Promise<boolean> {
    if (
      session.status !== "authenticated" ||
      !database.current ||
      !vault.current
    )
      return false;
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
    return true;
  }
  async function submit(
    event: FormEvent<HTMLFormElement>,
    kind: SelfStudyKind,
  ): Promise<boolean> {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      let committed = false;
      if (kind === "learning_track") {
        committed = await commit(kind, {
          title: String(data.get("title")),
          objective: String(data.get("objective")),
        });
      }
      if (kind === "inbox_item") {
        committed = await commit(kind, {
          title: String(data.get("title")),
          note: String(data.get("note")),
        });
      }
      if (kind === "study_project") {
        const track = String(data.get("track_id"));
        committed = await commit(
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
        committed = await commit(
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
      if (!committed) return false;
      form.reset();
      setStatus("记录已加密保存。");
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }
  async function submitResearch(
    event: FormEvent<HTMLFormElement>,
    kind: ResearchEntityType,
  ): Promise<boolean> {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      let committed = false;
      const sourceUrl = String(data.get("source_url") ?? "").trim();
      if (sourceUrl && safeResearchSourceUrl(sourceUrl) === null) {
        setStatus("来源 URL 只能使用 HTTP(S) 地址。");
        return false;
      }
      if (kind === "paper_record")
        committed = await commit(kind, {
          title: String(data.get("title")),
          citation_key: String(data.get("citation_key")),
          source_url: sourceUrl || null,
        });
      if (kind === "research_question")
        committed = await commit(kind, {
          question: String(data.get("question")),
          rationale: String(data.get("rationale")),
        });
      if (kind === "research_claim") {
        const parent = String(data.get("paper_id"));
        committed = await commit(
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
        committed = await commit(
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
        committed = await commit(
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
        committed = await commit(
          kind,
          {
            claim_id: parent,
            description: String(data.get("description")),
            requested_action: String(data.get("action")),
          },
          [parent],
        );
      }
      if (!committed) return false;
      form.reset();
      setStatus("研究记录已加密保存。");
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }
  async function submitCollaboration(
    event: FormEvent<HTMLFormElement>,
    kind: CollaborationEntityType,
  ): Promise<boolean> {
    event.preventDefault();
    if (spaces.find((space) => space.id === spaceId)?.visibility !== "shared") {
      setStatus("协作审阅只能写入当前账号有权访问的共享 Space。");
      return false;
    }
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      let committed = false;
      if (kind === "rubric")
        committed = await commit(kind, {
          title: String(data.get("title")),
          criteria: String(data.get("criteria")),
        });
      if (kind === "group_review") {
        const parent = String(data.get("rubric_id"));
        committed = await commit(
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
        committed = await commit(
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
        committed = await commit(
          kind,
          {
            review_id: parent,
            summary: String(data.get("summary")),
            published_at: new Date().toISOString(),
          },
          [parent],
        );
      }
      if (!committed) return false;
      form.reset();
      setStatus("共享记录已加密保存。");
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }
  const visible = (kind: Kind) =>
    records[kind].filter((x) => x.payload.space_id === spaceId);
  const researchPapers = visible("paper_record");
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
  if (mode === "research") {
    const researchData: ResearchWorkbenchData = {
      visibleClaims: visible("research_claim"),
      visibleFeedback: visible("research_feedback"),
      visibleMetrics: researchMetrics,
      visiblePapers: researchPapers,
      visibleQuestions: researchQuestions,
      visibleRuns: researchRuns,
      coverage: researchCoverage,
      comparison: metricComparison,
    };
    return (
      <ResearchWorkbench
        actions={{
          loadContext,
          setSpaceId,
          setWorkspaceId,
          submitResearch,
          synchronize,
          unlock,
        }}
        context={{
          contextPhase,
          dataPhase,
          deviceId,
          researchState,
          selectedSpace: spaces.find((space) => space.id === spaceId),
          selectedWorkspace: workspaces.find(
            (workspace) => workspace.id === workspaceId,
          ),
          spaceId,
          spaces,
          status,
          unlocked,
          workspaceId,
          workspaces,
        }}
        data={researchData}
      />
    );
  }
  if (mode === "collaboration") {
    const collaborationData: CollaborationWorkbenchData = {
      visibleFeedback: visible("group_feedback"),
      visibleReviews: visible("group_review"),
      visibleRubrics: visible("rubric"),
      visibleSnapshots: visible("report_snapshot"),
    };
    return (
      <CollaborationWorkbench
        actions={{
          loadContext,
          setSpaceId,
          setWorkspaceId,
          submitCollaboration,
          synchronize,
          unlock,
        }}
        context={{
          collaborationState,
          contextPhase,
          dataPhase,
          deviceId,
          selectedSpace: spaces.find((space) => space.id === spaceId),
          selectedWorkspace: workspaces.find(
            (workspace) => workspace.id === workspaceId,
          ),
          sharedSpaces: spaces.filter((space) => space.visibility === "shared"),
          spaceId,
          status,
          unlocked,
          workspaceId,
          workspaces,
        }}
        data={collaborationData}
      />
    );
  }
  if (mode === "self-study") {
    const selfStudyData: SelfStudyWorkbenchData = {
      deliverables: visible("deliverable"),
      inbox: visible("inbox_item"),
      projects: visible("study_project"),
      summary: selfStudySummary,
      tracks: visible("learning_track"),
    };
    return (
      <SelfStudyWorkbench
        actions={{
          loadContext,
          setSpaceId,
          setWorkspaceId,
          submit,
          synchronize,
          unlock,
        }}
        context={{
          deviceId,
          examState: selfStudyState,
          selectedSpace: spaces.find((space) => space.id === spaceId),
          selectedWorkspace: workspaces.find(
            (workspace) => workspace.id === workspaceId,
          ),
          spaceId,
          status,
          unlocked,
          workspaceId,
        }}
        data={selfStudyData}
      />
    );
  }
}
