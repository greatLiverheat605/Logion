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
type MasteryLevel =
  | "unknown"
  | "exposed"
  | "practicing"
  | "familiar"
  | "proficient"
  | "mastered";

interface TopicPayload extends JsonObject {
  space_id: string;
  title: string;
  description: string;
}

interface DependencyPayload extends JsonObject {
  space_id: string;
  prerequisite_topic_id: string;
  dependent_topic_id: string;
}

interface MasteryPayload extends JsonObject {
  space_id: string;
  topic_id: string;
  suggested_level: MasteryLevel;
  suggested_reason: string;
  suggested_at: string | null;
  confirmed_level: MasteryLevel | null;
  confirmed_at: string | null;
}

interface SchedulePayload extends JsonObject {
  space_id: string;
  topic_id: string;
  status: "scheduled" | "due" | "in_progress" | "completed" | "skipped";
  source: "mastery_confirmation" | "manual";
  interval_days: number;
  next_review_at: string;
  last_reviewed_at: string | null;
}

interface LocalView<T extends JsonObject> {
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("正在准备审查中心……");
  const [topics, setTopics] = useState<LocalView<TopicPayload>[]>([]);
  const [dependencies, setDependencies] = useState<
    LocalView<DependencyPayload>[]
  >([]);
  const [mastery, setMastery] = useState<LocalView<MasteryPayload>[]>([]);
  const [schedules, setSchedules] = useState<LocalView<SchedulePayload>[]>([]);
  const [conflicts, setConflicts] = useState(0);
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
      setStatus("请解锁本地学习记录。");
    } catch (error) {
      setStatus(errorMessage(error));
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
    const [
      topicRows,
      dependencyRows,
      masteryRows,
      scheduleRows,
      conflictCount,
    ] = await Promise.all([
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "topic"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "topic_dependency"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "mastery"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "review_schedule"])
        .toArray(),
      db.conflicts
        .where("[workspace_id+status]")
        .equals([workspaceId, "open"])
        .count(),
    ]);
    const [nextTopics, nextDependencies, nextMastery, nextSchedules] =
      await Promise.all([
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
          scheduleRows.map((item) =>
            decrypt<SchedulePayload>(localVault, item),
          ),
        ),
      ]);
    setTopics(nextTopics);
    setDependencies(nextDependencies);
    setMastery(nextMastery);
    setSchedules(nextSchedules);
    setConflicts(conflictCount);
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
      setStatus("审查数据已解锁；知识点与掌握确认支持断网编辑。");
      event.currentTarget.reset();
    } catch (error) {
      setUnlocked(false);
      setStatus(errorMessage(error));
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
    entityType: "mastery" | "topic" | "topic_dependency",
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
    entityType: "mastery" | "topic",
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

  const visibleTopics = topics.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleDependencies = dependencies.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const selectedSpace = spaces.find((item) => item.id === spaceId);
  const canEditGraph =
    selectedSpace?.visibility === "private" ||
    (selectedWorkspace !== undefined &&
      SHARED_GRAPH_EDITOR_ROLES.has(selectedWorkspace.role));

  return (
    <main id="main-content" className="settings-page today-page">
      <header>
        <p className="eyebrow">LOGION · REVIEW</p>
        <h1>把掌握判断与复习安排分开记录</h1>
        <p aria-live="polite">{status}</p>
        {conflicts > 0 ? (
          <p className="residual-data-warning" role="alert">
            有 {conflicts} 项冲突等待处理，系统不会静默覆盖掌握状态。
          </p>
        ) : null}
      </header>

      <section className="settings-card">
        <h2>审查上下文</h2>
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
          <label htmlFor="review-passphrase">本地口令</label>
          <input
            id="review-passphrase"
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
          <select id="topic-prerequisite" name="prerequisite_topic_id" required>
            {visibleTopics.map((item) => (
              <option key={item.entity.entity_id} value={item.entity.entity_id}>
                {item.payload.title}
              </option>
            ))}
          </select>
          <label htmlFor="topic-dependent">后学知识点</label>
          <select id="topic-dependent" name="dependent_topic_id" required>
            {visibleTopics.map((item) => (
              <option key={item.entity.entity_id} value={item.entity.entity_id}>
                {item.payload.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!unlocked || visibleTopics.length < 2 || !canEditGraph}
          >
            保存依赖到本地
          </button>
        </form>
        <p>{visibleDependencies.length} 条依赖已记录。</p>
      </section>

      <section className="settings-card sync-wide-card">
        <h2>个人掌握与复习</h2>
        <p>系统建议仅供参考；只有你明确提交的选项才是确认掌握度。</p>
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
                    defaultValue={current?.payload.confirmed_level ?? "unknown"}
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
            <p className="empty-state">当前空间还没有知识点。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
