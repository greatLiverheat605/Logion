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
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ProductBarChart,
  ProductDisclosure,
  ProductEmptyState,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductProgress,
  ProductSparkline,
  ProductTag,
  ProductWorkflowStage,
} from "@/components/product/product-ui";
import {
  deriveProductWorkbenchState,
  ProductWorkbenchStateNotice,
} from "@/components/product/product-workbench-state";
import {
  projectWorkbenchInspectorObject,
  WorkbenchObjectInspector,
  workbenchInspectorContextKey,
} from "@/components/product/workbench-object-inspector";
import { useInspector } from "@/features/desk/command-feedback-context";
import { classifyCommandError } from "@/features/desk/command-state";
import { useSession } from "@/features/auth/session-provider";
import { offlineUnlockMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { usePersona } from "@/features/personas/persona-context";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import {
  buildExamCoverageProjection,
  buildReviewGapProjection,
  buildScoreTrend,
  examScheduleDescriptor,
} from "./exam-workbench-model";

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

interface MockExamPayload extends JsonObject {
  space_id: string;
  exam_id: string;
  title: string;
  duration_limit_seconds: number;
}

interface ScoreRecordPayload extends JsonObject {
  space_id: string;
  mock_exam_id: string;
  score: number;
  score_scale_max: number;
  duration_seconds: number;
  completed_at: string;
}

interface ProtectedView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

type InspectorKind =
  | "exam"
  | "exam_subject"
  | "syllabus_node"
  | "mock_exam"
  | "score_record";

interface InspectorSelection {
  contextKey: string;
  kind: InspectorKind;
  id: string;
}

const EXAM_INSPECTOR_KINDS = [
  "exam",
  "exam_subject",
  "syllabus_node",
  "mock_exam",
  "score_record",
] as const satisfies readonly InspectorKind[];

function SyllabusTree({
  nodes,
  parentId = null,
  trail = new Set<string>(),
}: {
  nodes: ProtectedView<SyllabusNodePayload>[];
  parentId?: string | null;
  trail?: ReadonlySet<string>;
}) {
  const children = nodes.filter(
    (node) =>
      node.payload.parent_id === parentId && !trail.has(node.entity.entity_id),
  );
  if (children.length === 0) return null;
  return (
    <ul>
      {children.map((node) => (
        <li key={node.entity.entity_id}>
          {node.payload.title} · 重要度 {node.payload.importance} ·{" "}
          {node.payload.coverage_status === "covered"
            ? "已覆盖"
            : node.payload.coverage_status === "in_progress"
              ? "进行中"
              : "未开始"}
          <SyllabusTree
            nodes={nodes}
            parentId={node.entity.entity_id}
            trail={new Set([...trail, node.entity.entity_id])}
          />
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
  const state = classifyCommandError(error);
  const request = state.requestId ? `（请求编号：${state.requestId}）` : "";
  if (state.kind === "offline") {
    return "当前离线；只有已经写入 Outbox 的考试数据才会在恢复网络后同步。";
  }
  if (state.kind === "permission_denied") {
    return `当前账号没有权限完成此操作${request}。`;
  }
  if (state.kind === "conflict") {
    return `考试数据已发生变化；请重新读取后再试${request}。`;
  }
  return error instanceof LogionApiError
    ? `操作未完成${request}。`
    : "操作未完成；请重试。";
}

function countdown(examAt: string | null): string {
  return examScheduleDescriptor(examAt).label;
}

function formatExamDate(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    ? EXAM_DATE_FORMATTER.format(timestamp)
    : fallback;
}

export function ExamCenter() {
  const { closeInspector, openInspector } = useInspector();
  const { activePersona } = usePersona();
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
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [dateStatus, setDateStatus] = useState<"scheduled" | "undetermined">(
    "scheduled",
  );
  const [syllabusSubjectId, setSyllabusSubjectId] = useState("");
  const unlocked = vaultPhase === "unlocked";
  const [status, setStatus] = useState("正在准备备考空间……");
  const [exams, setExams] = useState<ExamView[]>([]);
  const [subjects, setSubjects] = useState<ProtectedView<SubjectPayload>[]>([]);
  const [syllabusNodes, setSyllabusNodes] = useState<
    ProtectedView<SyllabusNodePayload>[]
  >([]);
  const [mockExams, setMockExams] = useState<ProtectedView<MockExamPayload>[]>(
    [],
  );
  const [scoreRecords, setScoreRecords] = useState<
    ProtectedView<ScoreRecordPayload>[]
  >([]);
  const [inspectorSelection, setInspectorSelection] =
    useState<InspectorSelection | null>(null);
  useEffect(() => () => closeInspector(), [closeInspector]);
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const contextRequestRef = useRef<AbortController | null>(null);
  const spacesRequestRef = useRef<AbortController | null>(null);
  const dataRequestIdRef = useRef(0);
  const currentWorkspaceIdRef = useRef(workspaceId);
  useEffect(
    () => () => {
      dataRequestIdRef.current += 1;
    },
    [],
  );

  const loadContext = useCallback(async () => {
    contextRequestRef.current?.abort();
    const controller = new AbortController();
    contextRequestRef.current = controller;
    setContextPhase("loading");
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
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
      setWorkspaces(workspaceResult.workspaces);
      const nextWorkspaceId = workspaceResult.workspaces.some(
        (item) => item.id === currentWorkspaceIdRef.current,
      )
        ? currentWorkspaceIdRef.current
        : (workspaceResult.workspaces[0]?.id ?? "");
      if (nextWorkspaceId !== currentWorkspaceIdRef.current) {
        spacesRequestRef.current?.abort();
        dataRequestIdRef.current += 1;
        setInspectorSelection(null);
        closeInspector();
        setSpaces([]);
        setSpaceId("");
        setDataPhase("idle");
      }
      currentWorkspaceIdRef.current = nextWorkspaceId;
      setWorkspaceId(nextWorkspaceId);
      setDeviceId(deviceResult.devices.find((item) => item.current)?.id ?? "");
      setStatus("请先解锁本地备考资料。");
      setContextPhase("ready");
    } catch (error) {
      if (
        controller.signal.aborted ||
        contextRequestRef.current !== controller
      ) {
        return;
      }
      setStatus(message(error));
      setContextPhase("error");
    } finally {
      if (contextRequestRef.current === controller) {
        contextRequestRef.current = null;
      }
    }
  }, [closeInspector]);

  const loadSpaces = useCallback(async (selected: string) => {
    spacesRequestRef.current?.abort();
    const controller = new AbortController();
    spacesRequestRef.current = controller;
    setContextPhase("loading");
    try {
      const result = await browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${encodeURIComponent(selected)}/spaces`,
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        spacesRequestRef.current !== controller ||
        currentWorkspaceIdRef.current !== selected
      ) {
        return;
      }
      setSpaces(result.spaces);
      setSpaceId((current) =>
        result.spaces.some((item) => item.id === current)
          ? current
          : (result.spaces[0]?.id ?? ""),
      );
      setContextPhase("ready");
    } catch (error) {
      if (
        controller.signal.aborted ||
        spacesRequestRef.current !== controller ||
        currentWorkspaceIdRef.current !== selected
      ) {
        return;
      }
      setSpaces([]);
      setSpaceId("");
      setStatus(message(error));
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
  ): Promise<boolean> {
    const targetWorkspaceId = workspaceId;
    if (db === null || localVault === null || !targetWorkspaceId) return false;
    const requestId = ++dataRequestIdRef.current;
    setDataPhase("loading");
    const activeDatabase = db;
    const activeVault = localVault;
    async function readProtected<T extends JsonObject>(entityType: string) {
      const rows = await activeDatabase.entities
        .where("[workspace_id+entity_type]")
        .equals([targetWorkspaceId, entityType])
        .toArray();
      return Promise.all(
        rows.map(async (entity) => {
          const reference = entity.payload.encrypted_payload_ref;
          const payload =
            typeof reference === "string"
              ? await activeVault.get(reference, targetWorkspaceId)
              : entity.payload;
          if (payload === null)
            throw new Error("protected payload unavailable");
          return { entity, payload: payload as T };
        }),
      );
    }
    const [nextExams, nextSubjects, nextNodes, nextMocks, nextScores] =
      await Promise.all([
        readProtected<ExamPayload>("exam"),
        readProtected<SubjectPayload>("exam_subject"),
        readProtected<SyllabusNodePayload>("syllabus_node"),
        readProtected<MockExamPayload>("mock_exam"),
        readProtected<ScoreRecordPayload>("score_record"),
      ]);
    if (
      dataRequestIdRef.current !== requestId ||
      currentWorkspaceIdRef.current !== targetWorkspaceId
    ) {
      return false;
    }
    setExams(nextExams);
    setSubjects(nextSubjects);
    setSyllabusNodes(nextNodes);
    setMockExams(nextMocks);
    setScoreRecords(nextScores);
    setDataPhase("ready");
    return true;
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
      setStatus("备考资料已解锁；考试可断网创建并稍后同步。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(offlineUnlockMessage(error) ?? message(error));
    }
  }

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    queueMicrotask(() => {
      const requestId = dataRequestIdRef.current + 1;
      void refresh(db, localVault)
        .then((applied) =>
          applied ? setStatus("备考资料已在应用内解锁。") : undefined,
        )
        .catch((error: unknown) => {
          if (
            currentWorkspaceIdRef.current !== workspaceId ||
            dataRequestIdRef.current !== requestId
          ) {
            return;
          }
          setDataPhase("error");
          setStatus(message(error));
        });
    });
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId]);

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

  async function createMockExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      session.status !== "authenticated" ||
      database.current === null ||
      vault.current === null
    )
      return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const examId = String(data.get("exam_id") ?? "");
    const now = new Date().toISOString();
    try {
      await new ProtectedOfflineRepository(
        database.current,
        vault.current,
      ).commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: "mock_exam",
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
          title: String(data.get("title") ?? "").trim(),
          duration_limit_seconds:
            Number(data.get("duration_minutes") ?? 1) * 60,
        },
        dependencies: await pendingDependencies([examId]),
      });
      form.reset();
      setStatus("模考已加密保存，正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
    }
  }

  async function createScoreRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      session.status !== "authenticated" ||
      database.current === null ||
      vault.current === null
    )
      return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const mockExamId = String(data.get("mock_exam_id") ?? "");
    const score = Number(data.get("score") ?? 0);
    const scoreScale = Number(data.get("score_scale_max") ?? 1);
    const now = new Date().toISOString();
    try {
      if (
        !Number.isFinite(score) ||
        score < 0 ||
        !Number.isFinite(scoreScale) ||
        scoreScale <= 0 ||
        score > scoreScale
      ) {
        setStatus("成绩无效：得分必须在 0 到满分之间。");
        return;
      }
      await new ProtectedOfflineRepository(
        database.current,
        vault.current,
      ).commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: "score_record",
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
          mock_exam_id: mockExamId,
          score,
          score_scale_max: scoreScale,
          duration_seconds: Number(data.get("duration_minutes") ?? 0) * 60,
          completed_at: now,
        },
        dependencies: await pendingDependencies([mockExamId]),
      });
      form.reset();
      setStatus("成绩已加密保存，正在尝试同步。");
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
  const visibleMocks = mockExams.filter(
    (item) =>
      item.payload.space_id === spaceId &&
      visibleExams.some(
        (exam) => exam.entity.entity_id === item.payload.exam_id,
      ),
  );
  const visibleScores = scoreRecords.filter(
    (item) =>
      item.payload.space_id === spaceId &&
      visibleMocks.some(
        (mock) => mock.entity.entity_id === item.payload.mock_exam_id,
      ),
  );
  const inspectorContextKey = workbenchInspectorContextKey({
    personaId: activePersona?.id ?? null,
    spaceId,
    unlocked,
    vaultRevision,
    workbench: "exam",
    workspaceId,
  });
  const selectedInspectorObject = useMemo(
    () =>
      projectWorkbenchInspectorObject({
        allowedKinds: EXAM_INSPECTOR_KINDS,
        contextAllowed:
          unlocked && inspectorSelection?.contextKey === inspectorContextKey,
        records: [
          ...exams,
          ...subjects,
          ...syllabusNodes,
          ...mockExams,
          ...scoreRecords,
        ],
        selection: inspectorSelection,
        spaceId,
        workspaceId,
      }),
    [
      exams,
      inspectorContextKey,
      inspectorSelection,
      mockExams,
      scoreRecords,
      spaceId,
      subjects,
      syllabusNodes,
      unlocked,
      workspaceId,
    ],
  );

  useEffect(() => {
    if (!inspectorSelection) {
      closeInspector();
      return;
    }
    if (!selectedInspectorObject) {
      closeInspector();
      const invalidSelection = inspectorSelection;
      const timeout = window.setTimeout(
        () =>
          setInspectorSelection((current) =>
            current === invalidSelection ? null : current,
          ),
        0,
      );
      return () => window.clearTimeout(timeout);
    }
    openInspector({
      body: <WorkbenchObjectInspector object={selectedInspectorObject} />,
      title: selectedInspectorObject.title,
    });
  }, [
    closeInspector,
    inspectorSelection,
    openInspector,
    selectedInspectorObject,
  ]);

  function resetInspectorSelection() {
    setInspectorSelection(null);
    closeInspector();
  }

  function selectInspector(kind: InspectorKind, id: string) {
    setInspectorSelection({ contextKey: inspectorContextKey, id, kind });
  }

  const primaryExam =
    visibleExams.find((item) => item.payload.status === "active") ??
    visibleExams.find((item) => item.payload.status === "planning") ??
    visibleExams[0];
  const coverageProjection = buildExamCoverageProjection({
    examId: primaryExam?.entity.entity_id ?? null,
    exams: visibleExams,
    subjects: visibleSubjects,
    syllabusNodes: visibleNodes,
  });
  const scoreTrend = buildScoreTrend({
    examId: primaryExam?.entity.entity_id ?? null,
    exams: visibleExams,
    mockExams: visibleMocks,
    scoreRecords: visibleScores,
  });
  const reviewGapProjection = buildReviewGapProjection({
    examId: primaryExam?.entity.entity_id ?? null,
    exams: visibleExams,
    subjects: visibleSubjects,
    syllabusNodes: visibleNodes,
    mockExams: visibleMocks,
    scoreRecords: visibleScores,
    reviewSchedules: [],
  });
  const coverageRate = coverageProjection?.coverageRate ?? null;
  const coveredNodes = coverageProjection?.coveredCount ?? 0;
  const nodeCount = coverageProjection?.nodeCount ?? 0;
  const normalizedScores =
    scoreTrend.status === "ok"
      ? scoreTrend.points.map((point) => point.normalizedPercent)
      : [];
  const latestNormalizedScore =
    scoreTrend.status === "ok"
      ? (scoreTrend.points.at(-1)?.normalizedPercent ?? null)
      : null;
  const validScoreIds = new Set(
    scoreTrend.status === "ok"
      ? scoreTrend.points.map((point) => point.scoreId)
      : [],
  );
  const primarySchedule = examScheduleDescriptor(
    primaryExam?.payload.exam_at ?? null,
  );
  const subjectWeightChart = visibleSubjects.map((subject) => ({
    label: subject.payload.name,
    value: subject.payload.weight_basis_points / 100,
  }));
  const allVisibleRecords = [
    ...visibleExams,
    ...visibleSubjects,
    ...visibleNodes,
    ...visibleMocks,
    ...visibleScores,
  ];
  const examState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(workspaceId && spaceId),
    hasData: allVisibleRecords.length > 0,
    stale: allVisibleRecords.some(
      (item) => item.entity.sync_status !== "clean",
    ),
    unlocked,
  });
  const showExamData =
    examState === "empty" ||
    examState === "offline-stale" ||
    examState === "ready";
  const examHeader = (
    <ProductPageHeader
      eyebrow="EXAM · PREPARATION COCKPIT"
      title="围绕大纲覆盖与错题风险安排备考"
      description={
        <>
          <p>倒计时只是背景，核心是科目覆盖、模考趋势和下一批补救任务。</p>
          <p className="product-page-status" aria-live="polite">
            {status}
          </p>
        </>
      }
      actions={
        <>
          {!unlocked ? (
            <a className="product-action-link" href="#exam-vault">
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
  );
  const examStateNotice = (
    <ProductWorkbenchStateNotice
      action={
        examState === "locked" ? (
          <a className="product-action-link" href="#exam-vault">
            解锁本地资料
          </a>
        ) : examState === "empty" ? (
          <a className="product-action-link primary" href="#exam-setup">
            创建第一项考试
          </a>
        ) : (
          <a className="product-action-link" href="#exam-vault">
            选择工作区与 Space
          </a>
        )
      }
      emptyDescription="当前 Space 尚无考试、科目或模考记录；先创建考试再逐步配置大纲。"
      emptyTitle="当前 Space 还没有备考项目"
      onRetry={() => void loadContext()}
      state={examState}
    />
  );
  const examVaultControls = (
    <ProductDisclosure
      id="exam-vault"
      summary="备考空间与本地资料"
      description="选择工作区、空间并解锁端侧加密内容"
      defaultOpen={!unlocked}
    >
      <div className="inline-form">
        <label htmlFor="exam-workspace">工作区</label>
        <select
          id="exam-workspace"
          value={workspaceId}
          onChange={(event) => {
            const nextWorkspaceId = event.target.value;
            resetInspectorSelection();
            spacesRequestRef.current?.abort();
            dataRequestIdRef.current += 1;
            currentWorkspaceIdRef.current = nextWorkspaceId;
            setSpaces([]);
            setSpaceId("");
            setDataPhase("idle");
            setWorkspaceId(nextWorkspaceId);
          }}
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
          onChange={(event) => {
            resetInspectorSelection();
            setSpaceId(event.target.value);
          }}
        >
          {spaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
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
        <button type="submit">{unlocked ? "重新解锁" : "解锁资料"}</button>
      </form>
    </ProductDisclosure>
  );

  if (!showExamData) {
    return (
      <main id="main-content" className="settings-page today-page">
        {examHeader}
        {examStateNotice}
        {examVaultControls}
      </main>
    );
  }

  return (
    <main id="main-content" className="settings-page today-page">
      {examHeader}
      {examStateNotice}

      <ProductWorkflowStage
        badge={
          <ProductTag tone={primaryExam ? "warn" : "info"}>
            {primaryExam ? primarySchedule.label : "尚未建立考试"}
          </ProductTag>
        }
        title={primaryExam?.payload.title ?? "建立你的第一个备考目标"}
        stepsLabel="备考推进流程"
        steps={[
          {
            label: "建立考试目标",
            detail: primaryExam
              ? primarySchedule.label
              : "记录日期、目标分和计分尺度",
            state: primaryExam ? "complete" : "current",
          },
          {
            label: "覆盖重点大纲",
            detail: `${coveredNodes} / ${nodeCount} 个有效节点已覆盖`,
            state: !primaryExam
              ? "pending"
              : nodeCount === 0 || coverageRate === null || coverageRate < 100
                ? "current"
                : "complete",
          },
          {
            label: "完成一次模考",
            detail:
              latestNormalizedScore !== null
                ? `最近得分率 ${Math.round(latestNormalizedScore)}%`
                : `${visibleMocks.length} 场模考已安排`,
            state:
              latestNormalizedScore !== null
                ? "complete"
                : visibleMocks.length
                  ? "current"
                  : "pending",
          },
        ]}
        actions={
          <a
            className="product-action-link primary"
            href={
              primaryExam && nodeCount > 0 ? "#mock-practice" : "#exam-setup"
            }
          >
            {!primaryExam
              ? "建立考试目标"
              : nodeCount === 0
                ? "配置科目与大纲"
                : "安排或记录模考"}
          </a>
        }
      >
        {primaryExam
          ? primarySchedule.status !== "undetermined"
            ? `${formatExamDate(primaryExam.payload.exam_at, "考试日期待定")} · 目标 ${primaryExam.payload.target_score ?? "未设置"}${primaryExam.payload.score_scale_max ? ` / ${primaryExam.payload.score_scale_max}` : ""}`
            : "考试日期待定；可以先整理科目、大纲和第一场模考。"
          : "从真实考试日期、科目权重和大纲覆盖开始，再用模考成绩校准复习重点。"}
      </ProductWorkflowStage>

      <div className="product-metric-grid product-metric-grid-workflow">
        <ProductMetric
          label="备考项目"
          value={visibleExams.length}
          detail={`${visibleSubjects.length} 个科目`}
          tone="info"
        />
        <ProductMetric
          label="大纲覆盖"
          value={
            coverageRate === null ? "尚无数据" : `${Math.round(coverageRate)}%`
          }
          detail={
            coverageRate === null
              ? "添加大纲节点后再计算比例"
              : `${coveredNodes} / ${nodeCount} 个有效节点`
          }
          tone={coverageRate === null ? "default" : "good"}
        />
        <ProductMetric
          label="最近模考"
          value={
            latestNormalizedScore === null
              ? "—"
              : `${Math.round(latestNormalizedScore)}%`
          }
          detail={`${scoreTrend.status === "ok" ? scoreTrend.points.length : 0} 次有效成绩`}
          tone={latestNormalizedScore === null ? "default" : "info"}
        />
        <ProductMetric
          label="模考计划"
          value={visibleMocks.length}
          detail="限时练习"
        />
      </div>

      {examVaultControls}

      <div className="product-dashboard-grid product-dashboard-grid-wide">
        <ProductPanel
          title="科目权重"
          description="从已保存科目权重生成，不补充示例数据"
        >
          {subjectWeightChart.length ? (
            <ProductBarChart items={subjectWeightChart} label="科目权重分布" />
          ) : (
            <ProductEmptyState
              icon="◫"
              title="尚未设置科目"
              description="创建考试后添加科目与权重。"
            />
          )}
        </ProductPanel>
        <ProductPanel
          title="模考趋势"
          description="按成绩记录顺序展示标准化得分"
        >
          {normalizedScores.length ? (
            <>
              <ProductSparkline
                values={normalizedScores}
                label="模考成绩趋势"
              />
              <ProductProgress
                label="最近一次得分率"
                value={latestNormalizedScore ?? 0}
                tone="info"
              />
            </>
          ) : (
            <ProductEmptyState
              icon="⌁"
              title="等待第一场模考"
              description="完成模考并记录成绩后，这里会出现真实趋势。"
            />
          )}
        </ProductPanel>
      </div>

      <ProductPanel
        id="exam-coverage"
        title="覆盖矩阵与复习缺口"
        description="只展示已解析的考试链路；缺失或非法关系不会被估算。"
        aside={
          <ProductTag tone={coverageRate === null ? "default" : "info"}>
            {coverageRate === null
              ? "覆盖待定"
              : `${Math.round(coverageRate)}% 覆盖`}
          </ProductTag>
        }
      >
        {coverageProjection === null || coverageRate === null ? (
          <ProductEmptyState
            icon="◫"
            title="覆盖率待定"
            description="当前没有可解析的大纲节点；先建立科目和大纲，再计算覆盖率。"
          />
        ) : (
          <ProductProgress
            label={`${coveredNodes} / ${nodeCount} 个有效大纲节点已覆盖`}
            value={coverageRate}
            tone={coverageRate >= 80 ? "good" : "warn"}
          />
        )}
        <div className="product-task-list">
          <h3>复习缺口</h3>
          {reviewGapProjection.status === "unknown" ? (
            <p>考试或成绩链路待定，暂不生成复习缺口。</p>
          ) : reviewGapProjection.syllabusGaps.length === 0 &&
            reviewGapProjection.scoreGaps.length === 0 ? (
            <p>当前没有可确认的覆盖或成绩缺口。</p>
          ) : (
            <ul>
              {reviewGapProjection.syllabusGaps.map((gap) => {
                const node = visibleNodes.find(
                  (item) => item.entity.entity_id === gap.nodeId,
                );
                return (
                  <li key={`syllabus-${gap.nodeId}`}>
                    大纲缺口：{node?.payload.title ?? gap.nodeId}
                  </li>
                );
              })}
              {reviewGapProjection.scoreGaps.map((gap) => {
                const score = visibleScores.find(
                  (item) => item.entity.entity_id === gap.scoreId,
                );
                return (
                  <li key={`score-${gap.scoreId}`}>
                    成绩缺口：{score?.payload.score ?? "未知"} /{" "}
                    {score?.payload.score_scale_max ?? "未知"}（低于目标）
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ProductPanel>

      <ProductDisclosure
        id="exam-setup"
        summary="配置考试、科目与大纲"
        description="按顺序建立备考结构，所有内容沿用现有加密与同步流程"
      >
        <div className="product-config-grid">
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
                  setDateStatus(
                    event.target.value as "scheduled" | "undetermined",
                  )
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
              <input
                id="exam-target"
                name="target_score"
                type="number"
                min={0}
              />
              <label htmlFor="exam-scale">满分（填写目标分时必填）</label>
              <input
                id="exam-scale"
                name="score_scale_max"
                type="number"
                min={1}
              />
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
                  <option
                    key={exam.entity.entity_id}
                    value={exam.entity.entity_id}
                  >
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
                  .filter(
                    (node) => node.payload.subject_id === syllabusSubjectId,
                  )
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
              <input
                id="syllabus-title"
                name="title"
                maxLength={240}
                required
              />
              <label htmlFor="syllabus-importance">重要度</label>
              <select
                id="syllabus-importance"
                name="importance"
                defaultValue="3"
              >
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
        </div>
      </ProductDisclosure>

      <ProductPanel
        className="sync-wide-card"
        id="mock-practice"
        title="模考与成绩记录"
        description="建立限时练习，完成后记录真实得分和用时。"
        aside={
          <ProductTag tone="info">{validScoreIds.size} 次有效成绩</ProductTag>
        }
      >
        <div className="product-config-grid">
          <form className="planning-form" onSubmit={createMockExam}>
            <label htmlFor="mock-exam">所属考试</label>
            <select id="mock-exam" name="exam_id" required>
              <option value="">请选择</option>
              {visibleExams.map((exam) => (
                <option
                  key={exam.entity.entity_id}
                  value={exam.entity.entity_id}
                >
                  {exam.payload.title}
                </option>
              ))}
            </select>
            <label htmlFor="mock-title">模考名称</label>
            <input id="mock-title" name="title" maxLength={160} required />
            <label htmlFor="mock-duration">限时（分钟）</label>
            <input
              id="mock-duration"
              name="duration_minutes"
              type="number"
              min={1}
              max={1440}
              required
            />
            <button
              type="submit"
              disabled={!unlocked || visibleExams.length === 0}
            >
              加密保存模考
            </button>
          </form>
          <form className="planning-form" onSubmit={createScoreRecord}>
            <label htmlFor="score-mock">已完成模考</label>
            <select id="score-mock" name="mock_exam_id" required>
              <option value="">请选择</option>
              {visibleMocks.map((mock) => (
                <option
                  key={mock.entity.entity_id}
                  value={mock.entity.entity_id}
                >
                  {mock.payload.title}
                </option>
              ))}
            </select>
            <label htmlFor="score-value">得分</label>
            <input
              id="score-value"
              name="score"
              type="number"
              min={0}
              required
            />
            <label htmlFor="score-scale">满分</label>
            <input
              id="score-scale"
              name="score_scale_max"
              type="number"
              min={1}
              required
            />
            <label htmlFor="score-duration">实际用时（分钟）</label>
            <input
              id="score-duration"
              name="duration_minutes"
              type="number"
              min={0}
              max={1440}
              required
            />
            <button
              type="submit"
              disabled={!unlocked || visibleMocks.length === 0}
            >
              记录正式成绩
            </button>
          </form>
        </div>
        <ol>
          {visibleScores
            .filter((record) => validScoreIds.has(record.entity.entity_id))
            .map((record) => {
              const mock = visibleMocks.find(
                (item) => item.entity.entity_id === record.payload.mock_exam_id,
              );
              return (
                <li key={record.entity.entity_id}>
                  {mock?.payload.title ?? "模考"}：{record.payload.score} /{" "}
                  {record.payload.score_scale_max} ·{" "}
                  {formatExamDate(record.payload.completed_at, "时间待定")}
                </li>
              );
            })}
        </ol>
      </ProductPanel>

      <ProductPanel
        className="sync-wide-card"
        title="我的考试"
        description="集中查看倒计时、目标分、科目与大纲结构。"
        aside={<ProductTag>{visibleExams.length} 项</ProductTag>}
      >
        <div className="task-grid">
          {visibleExams.map((exam) => (
            <article className="task-card" key={exam.entity.entity_id}>
              <span className="count-badge">
                {countdown(exam.payload.exam_at)}
              </span>
              <h3>{exam.payload.title}</h3>
              <button
                className="product-action-link"
                type="button"
                onClick={() => selectInspector("exam", exam.entity.entity_id)}
              >
                查看考试详情
              </button>
              <p>{formatExamDate(exam.payload.exam_at, "考试日期尚未确定")}</p>
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
            <ProductEmptyState
              icon="◎"
              title="当前空间还没有考试"
              description="打开上方配置面板，先录入考试名称和日期；日期尚未确定也可以开始。"
            />
          ) : null}
        </div>
      </ProductPanel>
    </main>
  );
}
