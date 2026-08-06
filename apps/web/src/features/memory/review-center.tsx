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
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductProgress,
  ProductSignalGrid,
  ProductTag,
  ProductWorkflowStage,
} from "@/components/product/product-ui";
import {
  deriveProductWorkbenchState,
  type ProductWorkbenchState,
  ProductWorkbenchStateNotice,
} from "@/components/product/product-workbench-state";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { buildSevenDayReviewLoad } from "./review-workbench-model";
import {
  ReviewKnowledgeSpaceGraph,
  type ReviewKnowledgeSpaceGraphTopic,
} from "./review-knowledge-space";
import type { KnowledgeSpaceGraphState } from "@/features/knowledge-space-prototype/knowledge-space-graph";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type MasteryLevel =
  | "unknown"
  | "exposed"
  | "practicing"
  | "familiar"
  | "proficient"
  | "mastered";

export interface TopicPayload extends JsonObject {
  space_id: string;
  title: string;
  description: string;
}

export interface DependencyPayload extends JsonObject {
  space_id: string;
  prerequisite_topic_id: string;
  dependent_topic_id: string;
}

export interface MasteryPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  suggested_level: MasteryLevel;
  suggested_reason: string;
  suggested_at: string | null;
  confirmed_level: MasteryLevel | null;
  confirmed_at: string | null;
}

export interface SchedulePayload extends JsonObject {
  space_id: string;
  topic_id: string;
  status: "scheduled" | "due" | "in_progress" | "completed" | "skipped";
  source: "mastery_confirmation" | "manual" | "quiz_error";
  interval_days: number;
  next_review_at: string;
  last_reviewed_at: string | null;
}

interface QuizItemPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  prompt: string;
  evaluation_mode: "exact_match" | "self_assessed";
}

interface QuizAttemptPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  quiz_item_id: string;
  response_text: string;
  confidence: number;
  error_cause: string | null;
}

interface ErrorPatternPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  cause: string;
  occurrence_count: number;
  status: "open" | "resolved";
  latest_attempt_id: string;
}

interface AuditReviewPayload extends JsonObject {
  space_id: string;
  cadence: "daily" | "weekly";
  period_start: string;
  period_end: string;
  status: "draft" | "completed";
  summary: string;
  completed_at: string | null;
}

interface ReviewFindingPayload extends JsonObject {
  space_id: string;
  audit_review_id: string;
  category: "progress" | "blocker" | "adjustment" | "error_pattern";
  description: string;
  suggested_action: string;
  status: "open" | "resolved";
}

export interface LocalView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

const MASTERY_OPTIONS: readonly { label: string; value: MasteryLevel }[] = [
  { label: "尚未接触", value: "unknown" },
  { label: "已经接触", value: "exposed" },
  { label: "正在练习", value: "practicing" },
  { label: "基本熟悉", value: "familiar" },
  { label: "能够熟练应用", value: "proficient" },
  { label: "已经掌握", value: "mastered" },
];
const MASTERY_CHART_LABELS: Record<MasteryLevel, string> = {
  unknown: "未接触",
  exposed: "已接触",
  practicing: "练习中",
  familiar: "基本熟悉",
  proficient: "熟练应用",
  mastered: "已掌握",
};
const REVIEW_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const SHARED_GRAPH_EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

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

function errorMessage(error: unknown): string {
  if (error instanceof LogionApiError) {
    if (error.status === 403 || error.status === 404) {
      return `当前账号无权访问或修改该内容（请求编号：${error.requestId}）。`;
    }
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  return "网络暂不可用，本地修改仍会保留并可继续编辑。";
}

async function decrypt<T extends JsonObject>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<LocalView<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  if (typeof reference !== "string")
    return { entity, payload: entity.payload as T };
  const payload = await vault.get(reference, entity.workspace_id);
  if (payload === null) throw new Error("protected payload unavailable");
  return { entity, payload: payload as T };
}

export function ReviewCenter() {
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
  const unlocked = vaultPhase === "unlocked";
  const [status, setStatus] = useState("正在准备审查中心……");
  const [referenceTime] = useState(() => Date.now());
  const [topics, setTopics] = useState<LocalView<TopicPayload>[]>([]);
  const [dependencies, setDependencies] = useState<
    LocalView<DependencyPayload>[]
  >([]);
  const [mastery, setMastery] = useState<LocalView<MasteryPayload>[]>([]);
  const [schedules, setSchedules] = useState<LocalView<SchedulePayload>[]>([]);
  const [quizItems, setQuizItems] = useState<LocalView<QuizItemPayload>[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<
    LocalView<QuizAttemptPayload>[]
  >([]);
  const [errorPatterns, setErrorPatterns] = useState<
    LocalView<ErrorPatternPayload>[]
  >([]);
  const [auditReviews, setAuditReviews] = useState<
    LocalView<AuditReviewPayload>[]
  >([]);
  const [reviewFindings, setReviewFindings] = useState<
    LocalView<ReviewFindingPayload>[]
  >([]);
  const [conflicts, setConflicts] = useState(0);
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const [knowledgeView, setKnowledgeView] = useState<"graph" | "list">("graph");

  const loadContext = useCallback(async () => {
    setContextPhase("loading");
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
      setStatus("请解锁本地学习记录。");
      setContextPhase("ready");
    } catch (error) {
      setStatus(errorMessage(error));
      setContextPhase("error");
    }
  }, []);

  const loadSpaces = useCallback(async (selected: string) => {
    setContextPhase("loading");
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
      setContextPhase("ready");
    } catch (error) {
      setSpaces([]);
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
    ) {
      throw new Error("invalid bootstrap response");
    }
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
    setDataPhase("loading");
    const entityTypes = [
      "topic",
      "topic_dependency",
      "mastery",
      "review_schedule",
      "quiz_item",
      "quiz_attempt",
      "error_pattern",
      "audit_review",
      "review_finding",
    ] as const;
    const [rows, conflictCount] = await Promise.all([
      Promise.all(
        entityTypes.map((entityType) =>
          db.entities
            .where("[workspace_id+entity_type]")
            .equals([workspaceId, entityType])
            .toArray(),
        ),
      ),
      db.conflicts
        .where("[workspace_id+status]")
        .equals([workspaceId, "open"])
        .count(),
    ]);
    const topicRows = rows[0] ?? [];
    const dependencyRows = rows[1] ?? [];
    const masteryRows = rows[2] ?? [];
    const scheduleRows = rows[3] ?? [];
    const quizItemRows = rows[4] ?? [];
    const quizAttemptRows = rows[5] ?? [];
    const errorPatternRows = rows[6] ?? [];
    const auditReviewRows = rows[7] ?? [];
    const reviewFindingRows = rows[8] ?? [];
    const [
      nextTopics,
      nextDependencies,
      nextMastery,
      nextSchedules,
      nextQuizItems,
      nextQuizAttempts,
      nextErrorPatterns,
      nextAuditReviews,
      nextReviewFindings,
    ] = await Promise.all([
      Promise.all(
        topicRows.map((item) => decrypt<TopicPayload>(localVault, item)),
      ),
      Promise.all(
        dependencyRows.map((item) =>
          decrypt<DependencyPayload>(localVault, item),
        ),
      ),
      Promise.all(
        masteryRows.map((item) => decrypt<MasteryPayload>(localVault, item)),
      ),
      Promise.all(
        scheduleRows.map((item) => decrypt<SchedulePayload>(localVault, item)),
      ),
      Promise.all(
        quizItemRows.map((item) => decrypt<QuizItemPayload>(localVault, item)),
      ),
      Promise.all(
        quizAttemptRows.map((item) =>
          decrypt<QuizAttemptPayload>(localVault, item),
        ),
      ),
      Promise.all(
        errorPatternRows.map((item) =>
          decrypt<ErrorPatternPayload>(localVault, item),
        ),
      ),
      Promise.all(
        auditReviewRows.map((item) =>
          decrypt<AuditReviewPayload>(localVault, item),
        ),
      ),
      Promise.all(
        reviewFindingRows.map((item) =>
          decrypt<ReviewFindingPayload>(localVault, item),
        ),
      ),
    ]);
    setTopics(nextTopics);
    setDependencies(nextDependencies);
    setMastery(nextMastery);
    setSchedules(nextSchedules);
    setQuizItems(nextQuizItems);
    setQuizAttempts(nextQuizAttempts);
    setErrorPatterns(nextErrorPatterns);
    setAuditReviews(nextAuditReviews);
    setReviewFindings(nextReviewFindings);
    setConflicts(conflictCount);
    setDataPhase("ready");
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
      setStatus("审查数据已解锁；知识点与掌握确认支持断网编辑。");
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
          .then(() => setStatus("复习资料已在应用内解锁。"))
          .catch((error: unknown) => {
            setDataPhase("error");
            setStatus(errorMessage(error));
          }),
    );
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
      const remaining = await db.outbox
        .where("[workspace_id+device_id]")
        .equals([workspaceId, deviceId])
        .toArray();
      const blocked = remaining.filter(
        (item) => item.outbox_state === "blocked",
      ).length;
      const conflicted = remaining.filter(
        (item) => item.outbox_state === "conflict",
      ).length;
      if (conflicted > 0) {
        setStatus(`有 ${conflicted} 项掌握或图谱冲突等待人工处理。`);
      } else if (blocked > 0) {
        setStatus(`有 ${blocked} 项修改因权限、版本或输入校验未同步。`);
      } else if (remaining.length > 0) {
        setStatus(`仍有 ${remaining.length} 项本地修改等待网络恢复。`);
      } else {
        setStatus("审查数据已同步。");
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      await refresh(db, localVault);
    }
  }

  async function commit(
    entityType:
      | "audit_review"
      | "error_pattern"
      | "mastery"
      | "quiz_attempt"
      | "quiz_item"
      | "review_finding"
      | "topic"
      | "topic_dependency",
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

  async function pendingEntityOperations(
    entityType:
      | "audit_review"
      | "mastery"
      | "quiz_attempt"
      | "quiz_item"
      | "review_finding"
      | "topic",
    entityIds: string[],
  ): Promise<string[]> {
    const db = database.current;
    if (db === null) return [];
    const operations = await Promise.all(
      entityIds.map((id) =>
        db.outbox
          .where("[workspace_id+entity_type+entity_id]")
          .equals([workspaceId, entityType, id])
          .last(),
      ),
    );
    return operations.flatMap((item) =>
      item === undefined ? [] : [item.operation_id],
    );
  }

  async function createTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await commit("topic", crypto.randomUUID(), {
        space_id: spaceId,
        title: String(data.get("title") ?? "").trim(),
        description: String(data.get("description") ?? "").trim(),
      });
      form.reset();
      setStatus("知识点已保存到本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function createDependency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const prerequisite = String(data.get("prerequisite_topic_id") ?? "");
    const dependent = String(data.get("dependent_topic_id") ?? "");
    if (!prerequisite || !dependent || prerequisite === dependent) {
      setStatus("请选择两个不同的知识点建立依赖。");
      return;
    }
    try {
      await commit(
        "topic_dependency",
        crypto.randomUUID(),
        {
          space_id: spaceId,
          prerequisite_topic_id: prerequisite,
          dependent_topic_id: dependent,
        },
        undefined,
        await pendingEntityOperations("topic", [prerequisite, dependent]),
      );
      setStatus("知识依赖已保存到本地；正在尝试同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function confirmMastery(
    event: FormEvent<HTMLFormElement>,
    topic: LocalView<TopicPayload>,
  ) {
    event.preventDefault();
    const current = mastery.find(
      (item) => item.payload.topic_id === topic.entity.entity_id,
    );
    const schedule = schedules.find(
      (item) => item.payload.topic_id === topic.entity.entity_id,
    );
    const pendingScheduleId = current?.payload.schedule_id;
    const confirmedLevel = String(
      new FormData(event.currentTarget).get("confirmed_level") ?? "unknown",
    ) as MasteryLevel;
    try {
      const topicDependencies = await pendingEntityOperations("topic", [
        topic.entity.entity_id,
      ]);
      const masteryDependencies = current
        ? await pendingEntityOperations("mastery", [current.entity.entity_id])
        : [];
      await commit(
        "mastery",
        current?.entity.entity_id ?? crypto.randomUUID(),
        {
          space_id: spaceId,
          topic_id: topic.entity.entity_id,
          action: "confirm",
          schedule_id:
            schedule?.entity.entity_id ??
            (typeof pendingScheduleId === "string"
              ? pendingScheduleId
              : crypto.randomUUID()),
          suggested_level: current?.payload.suggested_level ?? "unknown",
          suggested_reason: current?.payload.suggested_reason ?? "",
          suggested_at: current?.payload.suggested_at ?? null,
          confirmed_level: confirmedLevel,
          confirmed_at: current?.payload.confirmed_at ?? null,
        },
        current?.entity,
        [...new Set([...topicDependencies, ...masteryDependencies])],
      );
      setStatus("人工掌握确认已保存在本地；系统建议没有被当作确认。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function createQuizItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const topicId = String(data.get("topic_id") ?? "");
    try {
      await commit(
        "quiz_item",
        crypto.randomUUID(),
        {
          space_id: spaceId,
          topic_id: topicId,
          prompt: String(data.get("prompt") ?? "").trim(),
          answer_key: String(data.get("answer_key") ?? "").trim(),
          explanation: String(data.get("explanation") ?? "").trim(),
          evaluation_mode: String(data.get("evaluation_mode") ?? "exact_match"),
        },
        undefined,
        await pendingEntityOperations("topic", [topicId]),
      );
      form.reset();
      setStatus("测验题已加密保存在本地；答案不会在共享题目同步中公开。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function submitQuizAttempt(
    event: FormEvent<HTMLFormElement>,
    quiz: LocalView<QuizItemPayload>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const cause = String(data.get("error_cause") ?? "unknown");
    const pattern = errorPatterns.find(
      (item) =>
        item.payload.topic_id === quiz.payload.topic_id &&
        item.payload.cause === cause,
    );
    const schedule = schedules.find(
      (item) => item.payload.topic_id === quiz.payload.topic_id,
    );
    const pendingAttempt = quizAttempts.find(
      (item) =>
        item.payload.topic_id === quiz.payload.topic_id &&
        item.payload.error_cause === cause &&
        item.entity.sync_status === "pending",
    );
    const pendingPatternId = pendingAttempt?.payload.error_pattern_id;
    const pendingScheduleId = pendingAttempt?.payload.schedule_id;
    const [quizDependencies, attemptDependencies] = await Promise.all([
      pendingEntityOperations("quiz_item", [quiz.entity.entity_id]),
      pendingAttempt
        ? pendingEntityOperations("quiz_attempt", [
            pendingAttempt.entity.entity_id,
          ])
        : Promise.resolve([]),
    ]);
    try {
      await commit(
        "quiz_attempt",
        crypto.randomUUID(),
        {
          space_id: spaceId,
          topic_id: quiz.payload.topic_id,
          quiz_item_id: quiz.entity.entity_id,
          error_pattern_id:
            pattern?.entity.entity_id ??
            (typeof pendingPatternId === "string"
              ? pendingPatternId
              : crypto.randomUUID()),
          schedule_id:
            schedule?.entity.entity_id ??
            (typeof pendingScheduleId === "string"
              ? pendingScheduleId
              : crypto.randomUUID()),
          response_text: String(data.get("response_text") ?? "").trim(),
          confidence: Number(data.get("confidence") ?? 3),
          duration_seconds: Number(data.get("duration_seconds") ?? 0),
          self_assessed_correct:
            quiz.payload.evaluation_mode === "self_assessed"
              ? data.get("self_assessed_correct") === "true"
              : null,
          error_cause:
            quiz.payload.evaluation_mode === "self_assessed" &&
            data.get("self_assessed_correct") === "true"
              ? null
              : cause,
        },
        undefined,
        [...new Set([...quizDependencies, ...attemptDependencies])],
      );
      form.reset();
      setStatus("答题记录已加密保存在本地；联网后由服务端判定并回流复习。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function createAuditReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await commit("audit_review", crypto.randomUUID(), {
        space_id: spaceId,
        cadence: String(data.get("cadence") ?? "daily"),
        period_start: String(data.get("period_start") ?? ""),
        period_end: String(data.get("period_end") ?? ""),
        summary: String(data.get("summary") ?? "").trim(),
        status: "draft",
        completed_at: null,
      });
      form.reset();
      setStatus("审查草稿已保存在本地；只有明确完成操作才会改变状态。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function addReviewFinding(
    event: FormEvent<HTMLFormElement>,
    review: LocalView<AuditReviewPayload>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await commit(
        "review_finding",
        crypto.randomUUID(),
        {
          space_id: spaceId,
          audit_review_id: review.entity.entity_id,
          category: String(data.get("category") ?? "progress"),
          description: String(data.get("description") ?? "").trim(),
          suggested_action: String(data.get("suggested_action") ?? "").trim(),
          status: "open",
        },
        undefined,
        await pendingEntityOperations("audit_review", [
          review.entity.entity_id,
        ]),
      );
      form.reset();
      setStatus("审查发现已保存在本地。 ");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function completeAuditReview(review: LocalView<AuditReviewPayload>) {
    try {
      const relatedFindings = reviewFindings.filter(
        (item) =>
          item.payload.audit_review_id === review.entity.entity_id &&
          item.entity.sync_status === "pending",
      );
      const [reviewDependencies, findingDependencies] = await Promise.all([
        pendingEntityOperations("audit_review", [review.entity.entity_id]),
        pendingEntityOperations(
          "review_finding",
          relatedFindings.map((item) => item.entity.entity_id),
        ),
      ]);
      await commit(
        "audit_review",
        review.entity.entity_id,
        {
          ...review.payload,
          action: "complete",
          status: "completed",
          completed_at: new Date().toISOString(),
        },
        review.entity,
        [...new Set([...reviewDependencies, ...findingDependencies])],
      );
      setStatus("审查完成已由你明确确认并保存在本地。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function resolveFinding(finding: LocalView<ReviewFindingPayload>) {
    try {
      await commit(
        "review_finding",
        finding.entity.entity_id,
        { ...finding.payload, action: "resolve", status: "resolved" },
        finding.entity,
        await pendingEntityOperations("review_finding", [
          finding.entity.entity_id,
        ]),
      );
      setStatus("审查发现已标记解决并等待同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  async function resolveErrorPattern(pattern: LocalView<ErrorPatternPayload>) {
    try {
      await commit(
        "error_pattern",
        pattern.entity.entity_id,
        { ...pattern.payload, action: "resolve", status: "resolved" },
        pattern.entity,
      );
      setStatus("错因模式已由你明确标记解决并等待同步。");
      await synchronize();
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
    }
  }

  const visibleTopics = topics.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleDependencies = dependencies.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleQuizItems = quizItems.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleAttempts = quizAttempts.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visiblePatterns = errorPatterns.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleReviews = auditReviews.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const selectedSpace = spaces.find((item) => item.id === spaceId);
  const canEditGraph =
    selectedSpace?.visibility === "private" ||
    (selectedWorkspace !== undefined &&
      SHARED_GRAPH_EDITOR_ROLES.has(selectedWorkspace.role));
  const visibleMastery = mastery.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleSchedules = schedules.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const confirmedMastery = visibleMastery.filter(
    (item) => item.payload.confirmed_level !== null,
  ).length;
  const dueReviews = visibleSchedules.filter(
    (item) =>
      item.payload.status === "due" ||
      new Date(item.payload.next_review_at).getTime() <= referenceTime,
  ).length;
  const openPatterns = visiblePatterns.filter(
    (item) => item.payload.status === "open",
  ).length;
  const masteryRate = visibleTopics.length
    ? (confirmedMastery / visibleTopics.length) * 100
    : 0;
  const masteryChart = MASTERY_OPTIONS.map((option) => ({
    label: MASTERY_CHART_LABELS[option.value],
    value: visibleMastery.filter(
      (item) => item.payload.confirmed_level === option.value,
    ).length,
  }));
  const futureReviewLoad = buildSevenDayReviewLoad(
    visibleSchedules.map((item) => item.payload),
    new Date(referenceTime),
  );
  const allVisibleRecords = [
    ...visibleTopics,
    ...visibleDependencies,
    ...visibleMastery,
    ...visibleSchedules,
    ...visibleQuizItems,
    ...visibleAttempts,
    ...visiblePatterns,
    ...visibleReviews,
  ];
  const reviewState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(workspaceId && spaceId),
    hasData: allVisibleRecords.length > 0,
    stale:
      conflicts > 0 ||
      allVisibleRecords.some((item) => item.entity.sync_status !== "clean"),
    unlocked,
  });
  const masteryRecordByTopicId = new Map(
    visibleMastery.map(
      (item) => [item.payload.topic_id, item.payload] as const,
    ),
  );
  const scheduleRecordByTopicId = new Map(
    visibleSchedules.map(
      (item) => [item.payload.topic_id, item.payload] as const,
    ),
  );

  const knowledgeTopics: ReviewKnowledgeSpaceGraphTopic[] = visibleTopics.map(
    (topic) => {
      const mastery = masteryRecordByTopicId.get(topic.entity.entity_id);
      const schedule = scheduleRecordByTopicId.get(topic.entity.entity_id);
      return {
        id: topic.entity.entity_id,
        title: topic.payload.title,
        description: topic.payload.description,
        confirmedLevel: mastery?.confirmed_level ?? null,
        suggestedLevel: mastery?.suggested_level ?? null,
        nextReviewAt: schedule?.next_review_at ?? null,
        due:
          schedule !== undefined &&
          (schedule.status === "due" ||
            new Date(schedule.next_review_at).getTime() <= referenceTime),
      };
    },
  );
  const knowledgeDependencies = visibleDependencies.map((dependency) => ({
    prerequisiteId: dependency.payload.prerequisite_topic_id,
    dependentId: dependency.payload.dependent_topic_id,
  }));

  const toKnowledgeSpaceState = (
    reviewState: ProductWorkbenchState,
  ): KnowledgeSpaceGraphState => {
    switch (reviewState) {
      case "ready":
        return "ready";
      case "empty":
        return "empty";
      case "locked":
        return "locked";
      case "error":
        return "error";
      case "loading":
        return "loading";
      case "needs-context":
        return "locked";
      case "offline-stale":
        return "ready";
    }
  };

  return (
    <main id="main-content" className="settings-page today-page">
      <ProductPageHeader
        eyebrow="REVIEW · ACTIVE RECALL"
        title="把“看过”变成真正能回忆"
        description={
          <>
            <p>到期队列、主动回忆、掌握变化和错因模式在同一工作流中完成。</p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
        actions={
          <>
            {!unlocked ? (
              <a className="product-action-link" href="#review-vault">
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
      <ProductWorkbenchStateNotice
        action={
          reviewState === "locked" ? (
            <a className="product-action-link" href="#review-vault">
              解锁本地资料
            </a>
          ) : reviewState === "empty" ? (
            <a className="product-action-link primary" href="#knowledge-graph">
              建立第一个知识点
            </a>
          ) : (
            <a className="product-action-link" href="#review-vault">
              选择工作区与 Space
            </a>
          )
        }
        emptyDescription="当前 Space 尚无知识点、回忆题或复习安排；先建立知识点再形成主动回忆闭环。"
        emptyTitle="当前 Space 还没有复习资料"
        onRetry={() => void loadContext()}
        state={reviewState}
      />
      {conflicts > 0 ? (
        <p className="residual-data-warning" role="alert">
          有 {conflicts} 项冲突等待处理，系统不会静默覆盖掌握状态。
        </p>
      ) : null}

      <ProductWorkflowStage
        badge={
          <ProductTag tone={dueReviews > 0 ? "warn" : "good"}>
            {dueReviews > 0 ? `${dueReviews} 项到期复习` : "复习节奏正常"}
          </ProductTag>
        }
        title={
          dueReviews > 0
            ? "先完成到期回忆，再补充新知识"
            : "用一次回忆检查真实掌握度"
        }
        stepsLabel="主动回忆闭环"
        steps={[
          {
            label: "完成到期回忆",
            detail: dueReviews
              ? `${dueReviews} 项安排已经到期`
              : `${visibleQuizItems.length} 道回忆题可练习`,
            state: dueReviews
              ? "current"
              : visibleAttempts.length
                ? "complete"
                : "pending",
          },
          {
            label: "确认真实掌握",
            detail: `${confirmedMastery} / ${visibleTopics.length} 个知识点已确认`,
            state: dueReviews
              ? "pending"
              : confirmedMastery
                ? "complete"
                : "current",
          },
          {
            label: "处理重复错因",
            detail: openPatterns
              ? `${openPatterns} 个开放错因等待处理`
              : "复盘错误原因并决定是否关闭",
            state: openPatterns
              ? "attention"
              : visibleAttempts.length
                ? "complete"
                : "pending",
          },
        ]}
        actions={
          <a
            className="product-action-link primary"
            href={
              visibleQuizItems.length ? "#active-recall" : "#knowledge-graph"
            }
          >
            {visibleQuizItems.length ? "开始主动回忆" : "建立知识图谱"}
          </a>
        }
      >
        系统建议只提供线索；掌握度、答题结果与错因处理都由你明确确认，复习安排据此形成。
      </ProductWorkflowStage>

      <div className="product-metric-grid product-metric-grid-workflow">
        <ProductMetric
          label="知识点"
          value={visibleTopics.length}
          detail={`${visibleDependencies.length} 条依赖关系`}
          tone="info"
        />
        <ProductMetric
          label="已确认掌握"
          value={visibleTopics.length ? confirmedMastery : "尚无数据"}
          detail={
            visibleTopics.length
              ? `${Math.round(masteryRate)}% 已留下判断`
              : "建立知识点后再计算比例"
          }
          tone="good"
        />
        <ProductMetric
          label="待复习"
          value={dueReviews}
          detail="来自现有复习计划"
          tone={dueReviews > 0 ? "warn" : "default"}
        />
        <ProductMetric
          label="开放错因"
          value={openPatterns}
          detail={`${visibleAttempts.length} 次答题记录`}
          tone={openPatterns > 0 ? "bad" : "default"}
        />
      </div>

      <ProductDisclosure
        id="review-vault"
        summary="复习空间与本地资料"
        description="切换知识空间并解锁端侧加密内容"
        defaultOpen={!unlocked}
      >
        <div className="inline-form">
          <label htmlFor="review-workspace">工作区</label>
          <select
            id="review-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="review-space">空间</label>
          <select
            id="review-space"
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
          <label htmlFor="review-passphrase">本地口令</label>
          <input
            id="review-passphrase"
            name="passphrase"
            type="password"
            minLength={10}
            autoComplete="current-password"
            required
          />
          <button type="submit">{unlocked ? "重新解锁" : "解锁资料"}</button>
        </form>
      </ProductDisclosure>

      <div className="product-dashboard-grid product-dashboard-grid-wide">
        <ProductPanel
          title="掌握度分布"
          description="仅统计你已经明确确认的掌握等级"
        >
          <ProductBarChart items={masteryChart} label="知识掌握度分布" />
          <ProductProgress label="确认覆盖率" value={masteryRate} tone="good" />
        </ProductPanel>
        <ProductPanel
          title="复习信号"
          description="根据现有记录聚合，不生成虚构评分"
        >
          <ProductSignalGrid
            label="复习信号指标"
            items={[
              { id: "due", label: "到期安排", value: dueReviews },
              {
                id: "quizzes",
                label: "形成性测验",
                value: visibleQuizItems.length,
              },
              { id: "errors", label: "开放错因", value: openPatterns },
              {
                id: "reviews",
                label: "审查记录",
                value: visibleReviews.length,
              },
            ]}
          />
        </ProductPanel>
      </div>

      <ProductPanel
        title="未来 7 天复习负荷"
        description="按复习计划的 next_review_at 汇总；逾期项目计入今天，不生成预测值。"
      >
        {visibleSchedules.length ? (
          <ProductBarChart
            items={futureReviewLoad}
            label="未来七天到期复习数量"
          />
        ) : (
          <ProductEmptyState
            description="完成掌握确认或测验后，真实复习安排会显示在这里。"
            title="尚无未来复习安排"
          />
        )}
      </ProductPanel>

      <ProductDisclosure
        id="knowledge-graph"
        summary="维护知识图谱"
        description="新增知识点并记录先修依赖；共享空间遵循现有角色权限"
      >
        <div className="product-config-grid">
          <section className="settings-card">
            <h2>新增知识点</h2>
            {!canEditGraph && spaceId ? (
              <p className="residual-data-warning">
                当前角色可以阅读共享知识图谱并确认自己的掌握度，但不能修改图谱。
              </p>
            ) : null}
            <form className="planning-form" onSubmit={createTopic}>
              <label htmlFor="topic-title">名称</label>
              <input id="topic-title" name="title" maxLength={160} required />
              <label htmlFor="topic-description">说明</label>
              <textarea
                id="topic-description"
                name="description"
                maxLength={10000}
              />
              <button
                type="submit"
                disabled={!unlocked || !spaceId || !canEditGraph}
              >
                保存到本地
              </button>
            </form>
          </section>

          <section className="settings-card">
            <h2>知识依赖</h2>
            <form className="planning-form" onSubmit={createDependency}>
              <label htmlFor="topic-prerequisite">先学知识点</label>
              <select
                id="topic-prerequisite"
                name="prerequisite_topic_id"
                required
              >
                {visibleTopics.map((item) => (
                  <option
                    key={item.entity.entity_id}
                    value={item.entity.entity_id}
                  >
                    {item.payload.title}
                  </option>
                ))}
              </select>
              <label htmlFor="topic-dependent">后学知识点</label>
              <select id="topic-dependent" name="dependent_topic_id" required>
                {visibleTopics.map((item) => (
                  <option
                    key={item.entity.entity_id}
                    value={item.entity.entity_id}
                  >
                    {item.payload.title}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={
                  !unlocked || visibleTopics.length < 2 || !canEditGraph
                }
              >
                保存依赖到本地
              </button>
            </form>
            <p>{visibleDependencies.length} 条依赖已记录。</p>
          </section>
        </div>
      </ProductDisclosure>

      <ProductPanel
        className="sync-wide-card"
        title="个人掌握与复习"
        description="系统建议仅供参考；只有你明确提交的选项才是确认掌握度。"
        aside={
          <div className="product-segmented" aria-label="知识视图" role="group">
            <button
              className={knowledgeView === "graph" ? "active" : undefined}
              type="button"
              onClick={() => setKnowledgeView("graph")}
            >
              图谱
            </button>
            <button
              className={knowledgeView === "list" ? "active" : undefined}
              type="button"
              onClick={() => setKnowledgeView("list")}
            >
              列表与掌握确认
            </button>
          </div>
        }
      >
        {knowledgeView === "graph" ? (
          <ReviewKnowledgeSpaceGraph
            topics={knowledgeTopics}
            dependencies={knowledgeDependencies}
            state={toKnowledgeSpaceState(reviewState)}
            onRetry={() => void loadContext()}
          />
        ) : (
          <div className="task-grid">
            {visibleTopics.map((topic) => {
              const current = mastery.find(
                (item) => item.payload.topic_id === topic.entity.entity_id,
              );
              const schedule = schedules.find(
                (item) => item.payload.topic_id === topic.entity.entity_id,
              );
              return (
                <article className="task-card" key={topic.entity.entity_id}>
                  <div>
                    <span className="count-badge">
                      {current?.payload.confirmed_level ?? "未确认"}
                    </span>
                    <h3>{topic.payload.title}</h3>
                    <p>{topic.payload.description || "暂无说明"}</p>
                    <p>
                      系统建议：{current?.payload.suggested_level ?? "unknown"}
                      {current?.payload.suggested_reason
                        ? ` · ${current.payload.suggested_reason}`
                        : " · 暂无依据"}
                    </p>
                    <p>
                      下次复习：
                      {schedule
                        ? REVIEW_DATE_FORMATTER.format(
                            new Date(schedule.payload.next_review_at),
                          )
                        : "确认后由同步服务生成"}
                    </p>
                    <small>{topic.entity.sync_status}</small>
                  </div>
                  <form
                    className="planning-form"
                    onSubmit={(event) => void confirmMastery(event, topic)}
                  >
                    <label htmlFor={`mastery-${topic.entity.entity_id}`}>
                      我的明确确认
                    </label>
                    <select
                      key={current?.payload.confirmed_level ?? "unknown"}
                      id={`mastery-${topic.entity.entity_id}`}
                      name="confirmed_level"
                      defaultValue={
                        current?.payload.confirmed_level ?? "unknown"
                      }
                    >
                      {MASTERY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit">确认并安排复习</button>
                  </form>
                </article>
              );
            })}
            {visibleTopics.length === 0 ? (
              <ProductEmptyState
                icon="◎"
                title="先建立知识图谱"
                description="从一个核心知识点开始，再补充它与其他概念之间的先修关系。"
              />
            ) : null}
          </div>
        )}
      </ProductPanel>

      <ProductDisclosure
        summary="创建形成性测验"
        description="围绕已有知识点建立主动回忆题；不用于监考或排名"
      >
        <p>共享题目不会在答题前同步答案，参考答案仅在提交后出现。</p>
        <form className="planning-form" onSubmit={createQuizItem}>
          <label htmlFor="quiz-topic">关联知识点</label>
          <select id="quiz-topic" name="topic_id" required>
            {visibleTopics.map((item) => (
              <option key={item.entity.entity_id} value={item.entity.entity_id}>
                {item.payload.title}
              </option>
            ))}
          </select>
          <label htmlFor="quiz-prompt">题目</label>
          <textarea id="quiz-prompt" name="prompt" maxLength={10000} required />
          <label htmlFor="quiz-answer">参考答案</label>
          <textarea
            id="quiz-answer"
            name="answer_key"
            maxLength={10000}
            required
          />
          <label htmlFor="quiz-explanation">解析</label>
          <textarea
            id="quiz-explanation"
            name="explanation"
            maxLength={20000}
          />
          <label htmlFor="quiz-mode">判定方式</label>
          <select id="quiz-mode" name="evaluation_mode">
            <option value="exact_match">服务端精确匹配</option>
            <option value="self_assessed">本人明确判断</option>
          </select>
          <button
            type="submit"
            disabled={!unlocked || !canEditGraph || visibleTopics.length === 0}
          >
            加密保存题目
          </button>
        </form>
      </ProductDisclosure>

      <ProductPanel
        className="sync-wide-card"
        id="active-recall"
        title="主动回忆练习"
        description="先作答，再查看判定；同时记录信心和错因。"
        aside={
          <ProductTag tone="info">{visibleQuizItems.length} 道题</ProductTag>
        }
      >
        <div className="task-grid">
          {visibleQuizItems.map((quiz) => {
            const latest = visibleAttempts.find(
              (item) => item.payload.quiz_item_id === quiz.entity.entity_id,
            );
            return (
              <article className="task-card" key={quiz.entity.entity_id}>
                <div>
                  <h3>{quiz.payload.prompt}</h3>
                  <p>判定：{quiz.payload.evaluation_mode}</p>
                  <small>{quiz.entity.sync_status}</small>
                  {latest ? (
                    <div>
                      <p>
                        最近结果：
                        {typeof latest.payload.is_correct === "boolean"
                          ? latest.payload.is_correct
                            ? "正确"
                            : "需要复习"
                          : "等待服务端判定"}
                      </p>
                      {typeof latest.payload.answer_key === "string" ? (
                        <p>提交后参考答案：{latest.payload.answer_key}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <form
                  className="planning-form"
                  onSubmit={(event) => void submitQuizAttempt(event, quiz)}
                >
                  <label htmlFor={`quiz-response-${quiz.entity.entity_id}`}>
                    我的答案
                  </label>
                  <textarea
                    id={`quiz-response-${quiz.entity.entity_id}`}
                    name="response_text"
                    maxLength={20000}
                    required
                  />
                  <label htmlFor={`quiz-confidence-${quiz.entity.entity_id}`}>
                    信心（1–5）
                  </label>
                  <input
                    id={`quiz-confidence-${quiz.entity.entity_id}`}
                    name="confidence"
                    type="number"
                    min={1}
                    max={5}
                    defaultValue={3}
                    required
                  />
                  <label htmlFor={`quiz-duration-${quiz.entity.entity_id}`}>
                    用时（秒）
                  </label>
                  <input
                    id={`quiz-duration-${quiz.entity.entity_id}`}
                    name="duration_seconds"
                    type="number"
                    min={0}
                    max={86400}
                    defaultValue={0}
                    required
                  />
                  {quiz.payload.evaluation_mode === "self_assessed" ? (
                    <div>
                      <label htmlFor={`quiz-result-${quiz.entity.entity_id}`}>
                        我的明确判断
                      </label>
                      <select
                        id={`quiz-result-${quiz.entity.entity_id}`}
                        name="self_assessed_correct"
                      >
                        <option value="false">需要复习</option>
                        <option value="true">回答正确</option>
                      </select>
                    </div>
                  ) : null}
                  <label htmlFor={`quiz-cause-${quiz.entity.entity_id}`}>
                    若错误，主要原因
                  </label>
                  <select
                    id={`quiz-cause-${quiz.entity.entity_id}`}
                    name="error_cause"
                  >
                    <option value="concept_confusion">概念混淆</option>
                    <option value="recall_gap">记忆缺口</option>
                    <option value="application_gap">应用不足</option>
                    <option value="misread">审题偏差</option>
                    <option value="careless">疏忽</option>
                    <option value="unknown">暂不确定</option>
                  </select>
                  <button type="submit" disabled={!unlocked}>
                    加密保存答题
                  </button>
                </form>
              </article>
            );
          })}
          {visibleQuizItems.length === 0 ? (
            <ProductEmptyState
              icon="?"
              title="还没有回忆题"
              description="为最容易遗忘的知识点创建一题，问题应促使你从记忆中提取，而不是简单识别。"
            />
          ) : null}
        </div>
      </ProductPanel>

      <ProductPanel
        title="个人错因模式"
        description="聚合反复出现的问题，解决后需要你明确关闭。"
        aside={
          <ProductTag tone={openPatterns > 0 ? "warn" : "good"}>
            {openPatterns} 项开放
          </ProductTag>
        }
      >
        {visiblePatterns.map((pattern) => (
          <article className="task-card" key={pattern.entity.entity_id}>
            <p>
              {pattern.payload.cause} · 累计 {pattern.payload.occurrence_count}{" "}
              次 ·{pattern.payload.status}
            </p>
            <button
              type="button"
              disabled={
                !unlocked ||
                pattern.payload.status !== "open" ||
                pattern.entity.server_version === 0
              }
              onClick={() => void resolveErrorPattern(pattern)}
            >
              明确标记已解决
            </button>
          </article>
        ))}
        {visiblePatterns.length === 0 ? (
          <ProductEmptyState
            icon="✓"
            title="尚未形成重复错因"
            description="完成更多回忆练习后，这里会汇总需要持续关注的问题。"
          />
        ) : null}
      </ProductPanel>

      <ProductDisclosure
        summary="创建每日或每周审查"
        description="将一段时间内的进展、阻塞和调整沉淀为复盘记录"
      >
        <form className="planning-form" onSubmit={createAuditReview}>
          <label htmlFor="audit-cadence">周期</label>
          <select id="audit-cadence" name="cadence">
            <option value="daily">每日</option>
            <option value="weekly">每周</option>
          </select>
          <label htmlFor="audit-start">开始日期</label>
          <input id="audit-start" name="period_start" type="date" required />
          <label htmlFor="audit-end">结束日期</label>
          <input id="audit-end" name="period_end" type="date" required />
          <label htmlFor="audit-summary">总结草稿</label>
          <textarea id="audit-summary" name="summary" maxLength={20000} />
          <button type="submit" disabled={!unlocked || !spaceId}>
            加密保存草稿
          </button>
        </form>
      </ProductDisclosure>

      <ProductPanel
        className="sync-wide-card"
        title="审查记录"
        description="从历史学习证据中提炼进展、阻塞和下一步。"
        aside={<ProductTag>{visibleReviews.length} 条记录</ProductTag>}
      >
        <div className="task-grid">
          {visibleReviews.map((review) => {
            const findings = reviewFindings.filter(
              (item) =>
                item.payload.audit_review_id === review.entity.entity_id,
            );
            return (
              <article className="task-card" key={review.entity.entity_id}>
                <h3>
                  {review.payload.cadence} · {review.payload.period_start} 至
                  {review.payload.period_end}
                </h3>
                <p>{review.payload.summary || "暂无总结"}</p>
                <p>状态：{review.payload.status}</p>
                {findings.map((finding) => (
                  <div key={finding.entity.entity_id}>
                    <p>
                      {finding.payload.category} · {finding.payload.description}{" "}
                      ·{finding.payload.status}
                    </p>
                    <button
                      type="button"
                      disabled={!unlocked || finding.payload.status !== "open"}
                      onClick={() => void resolveFinding(finding)}
                    >
                      明确标记发现已解决
                    </button>
                  </div>
                ))}
                {review.payload.status === "draft" ? (
                  <form
                    className="planning-form"
                    onSubmit={(event) => void addReviewFinding(event, review)}
                  >
                    <label
                      htmlFor={`finding-category-${review.entity.entity_id}`}
                    >
                      发现类型
                    </label>
                    <select
                      id={`finding-category-${review.entity.entity_id}`}
                      name="category"
                    >
                      <option value="progress">进展</option>
                      <option value="blocker">阻塞</option>
                      <option value="adjustment">调整</option>
                      <option value="error_pattern">错因</option>
                    </select>
                    <label
                      htmlFor={`finding-description-${review.entity.entity_id}`}
                    >
                      发现
                    </label>
                    <textarea
                      id={`finding-description-${review.entity.entity_id}`}
                      name="description"
                      maxLength={10000}
                      required
                    />
                    <label
                      htmlFor={`finding-action-${review.entity.entity_id}`}
                    >
                      下一步
                    </label>
                    <textarea
                      id={`finding-action-${review.entity.entity_id}`}
                      name="suggested_action"
                      maxLength={20000}
                    />
                    <button type="submit" disabled={!unlocked}>
                      添加发现
                    </button>
                    <button
                      type="button"
                      disabled={!unlocked}
                      onClick={() => void completeAuditReview(review)}
                    >
                      明确完成审查
                    </button>
                  </form>
                ) : null}
              </article>
            );
          })}
          {visibleReviews.length === 0 ? (
            <ProductEmptyState
              icon="◫"
              title="还没有复盘记录"
              description="完成一次学习周期后，创建审查并记录最重要的发现与下一步。"
            />
          ) : null}
        </div>
      </ProductPanel>
    </main>
  );
}
