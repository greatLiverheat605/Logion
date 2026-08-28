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

import { ExamWorkbench } from "./exam-workbench";
import { examCoverageRate, normalizeExamScores } from "./exam-workbench-model";
import { useExamController } from "./use-exam-controller";

export type Workspace = components["schemas"]["WorkspaceResponse"];
export type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];

export interface ExamPayload extends JsonObject {
  space_id: string;
  title: string;
  date_status: "scheduled" | "undetermined";
  exam_at: string | null;
  timezone: string | null;
  target_score: number | null;
  score_scale_max: number | null;
  status: "planning" | "active" | "completed" | "archived";
}

export interface ExamView {
  entity: LocalEntity;
  payload: ExamPayload;
}

export interface SubjectPayload extends JsonObject {
  space_id: string;
  exam_id: string;
  name: string;
  weight_basis_points: number;
  status: "active" | "archived";
}

export interface SyllabusNodePayload extends JsonObject {
  space_id: string;
  subject_id: string;
  parent_id: string | null;
  title: string;
  importance: number;
  coverage_status: "not_started" | "in_progress" | "covered";
}

export interface MockExamPayload extends JsonObject {
  space_id: string;
  exam_id: string;
  title: string;
  duration_limit_seconds: number;
}

export interface ScoreRecordPayload extends JsonObject {
  space_id: string;
  mock_exam_id: string;
  score: number;
  score_scale_max: number;
  duration_seconds: number;
  completed_at: string;
}

export interface ProtectedView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

const EXAM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function message(error: unknown): string {
  if (error instanceof LogionApiError) {
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  return "网络暂不可用；考试数据仍保存在本机 Outbox。";
}

export function ExamCenter() {
  const { request } = useExamController();
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
      setStatus("请先解锁本地备考资料。");
      setContextPhase("ready");
    } catch (error) {
      setStatus(message(error));
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
      setStatus(message(error));
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
    )
      throw new Error("invalid bootstrap response");
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
    const [nextExams, nextSubjects, nextNodes, nextMocks, nextScores] =
      await Promise.all([
        readProtected<ExamPayload>("exam"),
        readProtected<SubjectPayload>("exam_subject"),
        readProtected<SyllabusNodePayload>("syllabus_node"),
        readProtected<MockExamPayload>("mock_exam"),
        readProtected<ScoreRecordPayload>("score_record"),
      ]);
    setExams(nextExams);
    setSubjects(nextSubjects);
    setSyllabusNodes(nextNodes);
    setMockExams(nextMocks);
    setScoreRecords(nextScores);
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
      setStatus("备考资料已解锁；考试可断网创建并稍后同步。");
      event.currentTarget.reset();
      return true;
    } catch (error) {
      setStatus(message(error));
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
          .then(() => setStatus("备考资料已在应用内解锁。"))
          .catch((error: unknown) => {
            setDataPhase("error");
            setStatus(message(error));
          }),
    );
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId]);

  async function synchronize(): Promise<boolean> {
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null || !workspaceId || !deviceId)
      return false;
    let succeeded = false;
    try {
      await bootstrap(db, localVault);
      await new SyncClient(db, transport(request, workspaceId), localVault).synchronize(
        workspaceId,
        deviceId,
      );
      setStatus("备考数据已同步。");
      succeeded = true;
    } catch (error) {
      setStatus(message(error));
    } finally {
      await refresh(db, localVault);
    }
    return succeeded;
  }

  async function createExam(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    if (session.status !== "authenticated") return false;
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return false;
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
      return await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
      return false;
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

  async function createSubject(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    if (session.status !== "authenticated") return false;
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return false;
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
      return await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
      return false;
    }
  }

  async function createSyllabusNode(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    if (session.status !== "authenticated") return false;
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return false;
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
      return await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
      return false;
    }
  }

  async function createMockExam(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    if (
      session.status !== "authenticated" ||
      database.current === null ||
      vault.current === null
    )
      return false;
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
      return await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
      return false;
    }
  }

  async function createScoreRecord(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    if (
      session.status !== "authenticated" ||
      database.current === null ||
      vault.current === null
    )
      return false;
    const form = event.currentTarget;
    const data = new FormData(form);
    const mockExamId = String(data.get("mock_exam_id") ?? "");
    const score = Number(data.get("score") ?? 0);
    const scoreScale = Number(data.get("score_scale_max") ?? 1);
    const now = new Date().toISOString();
    try {
      if (score > scoreScale) throw new Error("score exceeds scale");
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
      return await synchronize();
    } catch (error) {
      setStatus(message(error));
      await refresh();
      return false;
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
  const primaryExam =
    visibleExams.find((item) => item.payload.status === "active") ??
    visibleExams.find((item) => item.payload.status === "planning") ??
    visibleExams[0];
  const coveredNodes = visibleNodes.filter(
    (item) => item.payload.coverage_status === "covered",
  ).length;
  const coverageRate = examCoverageRate(
    visibleNodes.map((item) => item.payload),
  );
  const normalizedScores = normalizeExamScores(
    visibleScores.map((item) => item.payload),
  );
  const latestNormalizedScore = normalizedScores.at(-1) ?? 0;
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

  return (
    <ExamWorkbench
      actions={{
        createExam,
        createMockExam,
        createScoreRecord,
        createSubject,
        createSyllabusNode,
        loadContext,
        setDateStatus,
        setSpaceId,
        setSyllabusSubjectId,
        setWorkspaceId,
        synchronize,
        unlock,
      }}
      context={{
        contextPhase,
        dataPhase,
        dateStatus,
        deviceId,
        examState,
        selectedSpace: spaces.find((item) => item.id === spaceId),
        selectedWorkspace: workspaces.find((item) => item.id === workspaceId),
        spaceId,
        spaces,
        status,
        syllabusSubjectId,
        unlocked,
        workspaceId,
        workspaces,
      }}
      data={{
        coveredNodes,
        coverageRate,
        latestNormalizedScore,
        normalizedScores,
        primaryExam,
        visibleExams,
        visibleMocks,
        visibleNodes,
        visibleScores,
        visibleSubjects,
      }}
    />
  );

}
