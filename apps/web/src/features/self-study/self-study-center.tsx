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
type Kind = "learning_track" | "study_project" | "inbox_item" | "deliverable";
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
  const { state: session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState(""),
    [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState(""),
    [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("正在准备自主学习空间……");
  const [records, setRecords] = useState<Record<Kind, View[]>>({
    learning_track: [],
    study_project: [],
    inbox_item: [],
    deliverable: [],
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
      setStatus("请解锁本地自主学习资料。");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, []);
  const loadSpaces = useCallback(async (id: string) => {
    try {
      const r = await browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${id}/spaces`,
      );
      setSpaces(r.spaces);
      setSpaceId((x) =>
        r.spaces.some((i) => i.id === x) ? x : (r.spaces[0]?.id ?? ""),
      );
    } catch (error) {
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
  const visible = (kind: Kind) =>
    records[kind].filter((x) => x.payload.space_id === spaceId);
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
