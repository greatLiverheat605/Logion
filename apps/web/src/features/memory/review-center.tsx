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

import { deriveProductWorkbenchState } from "@/components/product/product-workbench-state";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { LogionApiError, type ApiClient } from "@/lib/api/client";

import {
  buildKnowledgeGraph,
  buildSevenDayReviewLoad,
} from "./review-workbench-model";
import { ReviewWorkbench } from "./review-workbench";
import { useReviewController } from "./use-review-controller";

export type Workspace = components["schemas"]["WorkspaceResponse"];
export type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
export type MasteryLevel =
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

export interface QuizItemPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  prompt: string;
  evaluation_mode: "exact_match" | "self_assessed";
}

export interface QuizAttemptPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  quiz_item_id: string;
  response_text: string;
  confidence: number;
  error_cause: string | null;
}

export interface ErrorPatternPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  cause: string;
  occurrence_count: number;
  status: "open" | "resolved";
  latest_attempt_id: string;
}

export interface AuditReviewPayload extends JsonObject {
  space_id: string;
  cadence: "daily" | "weekly";
  period_start: string;
  period_end: string;
  status: "draft" | "completed";
  summary: string;
  completed_at: string | null;
}

export interface ReviewFindingPayload extends JsonObject {
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

const SHARED_GRAPH_EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

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
  const { request } = useReviewController();
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

  const loadContext = useCallback(async () => {
    setContextPhase("loading");
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        request<{ devices: Device[] }>("/api/v1/auth/devices"),
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
  }, [request]);

  const loadSpaces = useCallback(async (selected: string) => {
    setContextPhase("loading");
    try {
      const result = await request<{ spaces: Space[] }>(
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
  }, [request]);

  useEffect(() => {
    queueMicrotask(() => void loadContext());
  }, [loadContext]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadSpaces(workspaceId));
  }, [loadSpaces, request, workspaceId]);

  async function bootstrap(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
  ) {
    const current = await db.syncState.get(workspaceId);
    if (current?.bootstrap_state === "ready" && current.device_id === deviceId)
      return;
    const repository = new BootstrapRepository(db, {}, localVault);
    const first = await request<unknown>(
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
      const chunk = await request<unknown>(
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

  async function unlock(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (session.status !== "authenticated" || !workspaceId || !deviceId)
      return false;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus("审查数据已解锁；知识点与掌握确认支持断网编辑。");
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
      await new SyncClient(db, transport(request, workspaceId), localVault).synchronize(
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

  async function createTopic(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
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
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function createDependency(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const prerequisite = String(data.get("prerequisite_topic_id") ?? "");
    const dependent = String(data.get("dependent_topic_id") ?? "");
    if (!prerequisite || !dependent || prerequisite === dependent) {
      setStatus("请选择两个不同的知识点建立依赖。");
      return false;
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
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
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

  async function createQuizItem(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
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
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function submitQuizAttempt(
    event: FormEvent<HTMLFormElement>,
    quiz: LocalView<QuizItemPayload>,
  ): Promise<boolean> {
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
    try {
      const [quizDependencies, attemptDependencies] = await Promise.all([
        pendingEntityOperations("quiz_item", [quiz.entity.entity_id]),
        pendingAttempt
          ? pendingEntityOperations("quiz_attempt", [
              pendingAttempt.entity.entity_id,
            ])
          : Promise.resolve([]),
      ]);
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
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
    }
  }

  async function createAuditReview(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
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
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      await refresh();
      return false;
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
  const knowledgeGraph = buildKnowledgeGraph(
    visibleTopics.map((topic) => ({
      description: topic.payload.description,
      id: topic.entity.entity_id,
      title: topic.payload.title,
    })),
    visibleDependencies.map((dependency) => dependency.payload),
  );
  const masteryByTopicId = new Map(
    visibleMastery.flatMap((item) =>
      item.payload.confirmed_level
        ? [[item.payload.topic_id, item.payload.confirmed_level] as const]
        : [],
    ),
  );

  return (
    <ReviewWorkbench
      context={{
        canEditGraph,
        contextPhase,
        dataPhase,
        deviceId,
        conflicts,
        reviewState,
        selectedSpace,
        selectedWorkspace,
        spaceId,
        spaces,
        status,
        unlocked,
        workspaceId,
        workspaces,
      }}
      data={{
        dependencies: visibleDependencies,
        errorPatterns: visiblePatterns,
        futureReviewLoad,
        knowledgeGraph,
        mastery: visibleMastery,
        masteryByTopicId,
        quizAttempts: visibleAttempts,
        quizItems: visibleQuizItems,
        reviewFindings,
        reviews: visibleReviews,
        schedules: visibleSchedules,
        topics: visibleTopics,
        confirmedMastery,
        dueReviews,
        masteryRate,
        openPatterns,
      }}
      actions={{
        addReviewFinding,
        completeAuditReview,
        confirmMastery,
        createAuditReview,
        createDependency,
        createQuizItem,
        createTopic,
        loadContext,
        resolveErrorPattern,
        resolveFinding,
        submitQuizAttempt,
        synchronize,
        unlock,
        setSpaceId,
        setWorkspaceId,
      }}
    />
  );
}
