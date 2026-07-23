"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  databaseNameForUser,
  noteDocumentStateId,
  OfflineVault,
  openOfflineDatabase,
  ProtectedOfflineRepository,
  SyncClient,
  YjsNoteRepository,
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
type View<T> = { entity: LocalEntity; payload: T };
type NotePayload = JsonObject & {
  space_id: string;
  task_id: string | null;
  title: string;
  markdown_body: string;
};
type PageEntry = JsonObject & { page: number; label: string; note: string };
type ResourcePayload = JsonObject & {
  space_id: string;
  task_id: string | null;
  resource_type: "link" | "pdf_index";
  title: string;
  source_url: string | null;
  pdf_filename: string | null;
  page_count: number | null;
  sha256: string | null;
  page_index: PageEntry[];
};

function userMessage(error: unknown) {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）`
    : "网络暂不可用，修改已保存在本设备。";
}

function safeExternalUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function transport(workspaceId: string): SyncTransport {
  const call = (path: string, request: unknown, csrf = false) =>
    browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/${path}`, {
      method: "POST",
      csrf,
      body: JSON.stringify(request),
    });
  return {
    push: (request) => call("push", request, true),
    pull: (request) => call("pull", request),
  };
}

async function decrypt<T>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<View<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  const value =
    typeof reference === "string"
      ? await vault.get(reference, entity.workspace_id)
      : entity.payload;
  if (value === null) throw new Error("protected payload unavailable");
  return { entity, payload: value as unknown as T };
}

export function ContentCenter() {
  const { state: session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("正在准备记录与资料库……");
  const [notes, setNotes] = useState<View<NotePayload>[]>([]);
  const [resources, setResources] = useState<View<ResourcePayload>[]>([]);
  const [resourceType, setResourceType] = useState<"link" | "pdf_index">(
    "link",
  );
  const database = useRef<LogionOfflineDatabase | null>(null);
  const vault = useRef<OfflineVault | null>(null);

  const load = useCallback(async () => {
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      const current = deviceResult.devices.find((item) => item.current);
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceId(workspaceResult.workspaces[0]?.id ?? "");
      setDeviceId(current?.id ?? "");
      setStatus(current ? "请选择空间并解锁本地资料。" : "未找到当前设备。");
    } catch (error) {
      setStatus(userMessage(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    return () => database.current?.close();
  }, [load]);

  useEffect(() => {
    if (!workspaceId) return;
    queueMicrotask(
      () =>
        void browserApiClient
          .request<{ spaces: Space[] }>(
            `/api/v1/workspaces/${workspaceId}/spaces`,
          )
          .then((result) => {
            setSpaces(result.spaces);
            setSpaceId(result.spaces[0]?.id ?? "");
          })
          .catch((error: unknown) => setStatus(userMessage(error))),
    );
  }, [workspaceId]);

  async function bootstrap(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
  ) {
    const current = await db.syncState.get(workspaceId);
    if (current?.bootstrap_state === "ready" && current.device_id === deviceId)
      return;
    const repository = new BootstrapRepository(db, {}, localVault);
    const fetchChunk = (
      snapshot_id: string | null,
      chunk_index: number | null,
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
            known_sync_epoch: current?.sync_epoch ?? null,
            snapshot_id,
            chunk_index,
          }),
        },
      );
    const first = await fetchChunk(null, null);
    const validation = validateSyncV1Message(first);
    if (
      !validation.ok ||
      validation.value.message_type !== "bootstrap_response"
    ) {
      throw new Error("invalid bootstrap response");
    }
    const manifest = validation.value;
    await repository.stageChunk(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < manifest.chunk_count; index += 1) {
      await repository.stageChunk(
        await fetchChunk(manifest.snapshot_id, index),
        {
          workspace_id: workspaceId,
          device_id: deviceId,
        },
      );
    }
  }

  async function refresh(db = database.current, localVault = vault.current) {
    if (db === null || localVault === null) return;
    const [noteRows, resourceRows] = await Promise.all([
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "note"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "resource"])
        .toArray(),
    ]);
    const [nextNotes, nextResources] = await Promise.all([
      Promise.all(
        noteRows.map((item) => decrypt<NotePayload>(localVault, item)),
      ),
      Promise.all(
        resourceRows.map((item) => decrypt<ResourcePayload>(localVault, item)),
      ),
    ]);
    setNotes(nextNotes);
    setResources(nextResources);
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    try {
      const db = await openOfflineDatabase({
        databaseName: databaseNameForUser(session.user.id),
        indexedDB: globalThis.indexedDB ?? null,
        IDBKeyRange: globalThis.IDBKeyRange ?? null,
      });
      const localVault = new OfflineVault(db);
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase") ?? "",
      );
      if ((await db.vaultMetadata.get(session.user.id)) === undefined) {
        await localVault.initialize(session.user.id, passphrase);
      } else {
        await localVault.unlock(session.user.id, passphrase);
      }
      database.current?.close();
      database.current = db;
      vault.current = localVault;
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setUnlocked(true);
      setStatus("已解锁。Markdown 只按纯文本预览，不执行其中的 HTML。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(userMessage(error));
    }
  }

  async function synchronize() {
    const db = database.current;
    const localVault = vault.current;
    if (db === null || localVault === null) return;
    try {
      await new SyncClient(db, transport(workspaceId), localVault).synchronize(
        workspaceId,
        deviceId,
      );
      setStatus("笔记与资料索引已同步。");
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      await refresh(db, localVault);
    }
  }

  async function commit(
    entityType: "note" | "resource",
    entityId: string,
    payload: JsonObject,
    existing?: LocalEntity,
  ) {
    if (
      session.status !== "authenticated" ||
      database.current === null ||
      vault.current === null
    ) {
      throw new Error("locked");
    }
    const now = new Date().toISOString();
    return new ProtectedOfflineRepository(
      database.current,
      vault.current,
    ).commitMutation({
      operation_id: crypto.randomUUID(),
      protocol_version: "sync-v1",
      workspace_id: workspaceId,
      device_id: deviceId,
      entity_type: entityType,
      entity_id: entityId,
      operation_type: existing ? "update" : "create",
      base_version: existing?.server_version ?? 0,
      local_revision: (existing?.local_revision ?? 0) + 1,
      client_occurred_at: now,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      created_by: existing?.created_by ?? session.user.id,
      updated_by: session.user.id,
      payload,
    });
  }

  async function saveNote(
    event: FormEvent<HTMLFormElement>,
    note?: View<NotePayload>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const title = String(data.get("title") ?? "");
      const markdown = String(data.get("markdown_body") ?? "");
      if (
        note !== undefined &&
        title === note.payload.title &&
        markdown === note.payload.markdown_body
      ) {
        await synchronize();
        return;
      }
      const hasYjsState =
        note !== undefined && database.current !== null
          ? (await database.current.entities.get([
              workspaceId,
              "note_document_state",
              noteDocumentStateId(workspaceId, note.entity.entity_id),
            ])) !== undefined
          : false;
      if (
        note !== undefined &&
        title === note.payload.title &&
        hasYjsState &&
        session.status === "authenticated" &&
        database.current !== null &&
        vault.current !== null
      ) {
        await new YjsNoteRepository(
          database.current,
          vault.current,
        ).commitMarkdown({
          operation_id: crypto.randomUUID(),
          workspace_id: workspaceId,
          device_id: deviceId,
          note_id: note.entity.entity_id,
          next_markdown: markdown,
          updated_by: session.user.id,
          client_occurred_at: new Date().toISOString(),
        });
      } else {
        await commit(
          "note",
          note?.entity.entity_id ?? crypto.randomUUID(),
          {
            space_id: spaceId,
            task_id: note?.payload.task_id ?? null,
            title,
            markdown_body: markdown,
          },
          note?.entity,
        );
      }
      if (!note) form.reset();
      await synchronize();
    } catch (error) {
      setStatus(userMessage(error));
      await refresh();
    }
  }

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const page = Number(data.get("page") ?? 0);
    const payload: ResourcePayload = {
      space_id: spaceId,
      task_id: null,
      resource_type: resourceType,
      title: String(data.get("title") ?? ""),
      source_url: String(data.get("source_url") || "") || null,
      pdf_filename:
        resourceType === "pdf_index"
          ? String(data.get("pdf_filename") ?? "")
          : null,
      page_count:
        resourceType === "pdf_index"
          ? Number(data.get("page_count") ?? 0)
          : null,
      sha256: null,
      page_index:
        resourceType === "pdf_index" && page > 0
          ? [
              {
                page,
                label: String(data.get("label") ?? ""),
                note: String(data.get("note") ?? ""),
              },
            ]
          : [],
    };
    try {
      await commit("resource", crypto.randomUUID(), payload);
      form.reset();
      await synchronize();
    } catch (error) {
      setStatus(userMessage(error));
      await refresh();
    }
  }

  async function rename(resource: View<ResourcePayload>) {
    const title = window.prompt("资料名称", resource.payload.title)?.trim();
    if (!title) return;
    try {
      await commit(
        "resource",
        resource.entity.entity_id,
        { ...resource.payload, title },
        resource.entity,
      );
      await synchronize();
    } catch (error) {
      setStatus(userMessage(error));
      await refresh();
    }
  }

  const visibleNotes = notes.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleResources = resources.filter(
    (item) => item.payload.space_id === spaceId,
  );
  return (
    <main id="main-content" className="settings-page content-page">
      <header>
        <p className="eyebrow">LOGION · RECORDS</p>
        <h1>笔记与资料索引</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <h2>上下文与本地解锁</h2>
        <div className="inline-form">
          <label htmlFor="content-workspace">工作区</label>
          <select
            id="content-workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="content-space">空间</label>
          <select
            id="content-space"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
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
        <form className="inline-form" onSubmit={unlock}>
          <label htmlFor="content-passphrase">本地口令</label>
          <input
            id="content-passphrase"
            name="passphrase"
            type="password"
            minLength={10}
            required
          />
          <button type="submit">解锁</button>
        </form>
      </section>
      <section className="settings-card">
        <h2>新建 Markdown 笔记</h2>
        <form
          className="planning-form"
          onSubmit={(event) => void saveNote(event)}
        >
          <label htmlFor="note-title">标题</label>
          <input id="note-title" name="title" maxLength={200} required />
          <label htmlFor="note-body">正文</label>
          <textarea id="note-body" name="markdown_body" maxLength={500000} />
          <button type="submit" disabled={!unlocked}>
            保存到本地
          </button>
        </form>
      </section>
      <section className="settings-card">
        <h2>登记资料</h2>
        <form className="planning-form" onSubmit={saveResource}>
          <label htmlFor="resource-type">类型</label>
          <select
            id="resource-type"
            value={resourceType}
            onChange={(e) =>
              setResourceType(e.target.value as typeof resourceType)
            }
          >
            <option value="link">链接</option>
            <option value="pdf_index">PDF 索引（不上传正文）</option>
          </select>
          <label htmlFor="resource-title">名称</label>
          <input id="resource-title" name="title" required />
          <label htmlFor="resource-url">HTTP(S) 地址</label>
          <input
            id="resource-url"
            name="source_url"
            type="url"
            required={resourceType === "link"}
          />
          {resourceType === "pdf_index" ? (
            <>
              <label htmlFor="pdf-name">文件名</label>
              <input id="pdf-name" name="pdf_filename" required />
              <label htmlFor="pdf-count">总页数</label>
              <input
                id="pdf-count"
                name="page_count"
                type="number"
                min={1}
                required
              />
              <label htmlFor="pdf-page">索引页</label>
              <input id="pdf-page" name="page" type="number" min={1} required />
              <label htmlFor="pdf-label">索引标签</label>
              <input id="pdf-label" name="label" required />
              <label htmlFor="pdf-note">页码笔记</label>
              <textarea id="pdf-note" name="note" />
            </>
          ) : null}
          <button type="submit" disabled={!unlocked}>
            保存资料索引
          </button>
        </form>
      </section>
      <section className="settings-card sync-wide-card">
        <h2>笔记</h2>
        <div className="content-grid">
          {visibleNotes.map((note) => (
            <article className="task-card" key={note.entity.entity_id}>
              <form
                className="planning-form"
                onSubmit={(event) => void saveNote(event, note)}
              >
                <label htmlFor={`title-${note.entity.entity_id}`}>标题</label>
                <input
                  id={`title-${note.entity.entity_id}`}
                  name="title"
                  defaultValue={note.payload.title}
                  required
                />
                <label htmlFor={`body-${note.entity.entity_id}`}>
                  Markdown
                </label>
                <textarea
                  id={`body-${note.entity.entity_id}`}
                  name="markdown_body"
                  defaultValue={note.payload.markdown_body}
                />
                <button type="submit">保存修改</button>
              </form>
              <details>
                <summary>安全纯文本预览</summary>
                <pre className="markdown-safe-preview">
                  {note.payload.markdown_body}
                </pre>
              </details>
            </article>
          ))}
          {visibleNotes.length === 0 ? (
            <p className="empty-state">暂无笔记。</p>
          ) : null}
        </div>
      </section>
      <section className="settings-card sync-wide-card">
        <h2>资料</h2>
        <div className="content-grid">
          {visibleResources.map((resource) => (
            <article className="task-card" key={resource.entity.entity_id}>
              <h3>{resource.payload.title}</h3>
              <p>
                {resource.payload.resource_type === "link"
                  ? "链接"
                  : "PDF 页码索引"}
              </p>
              {safeExternalUrl(resource.payload.source_url) ? (
                <a
                  href={
                    safeExternalUrl(resource.payload.source_url) ?? undefined
                  }
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  打开外部资料
                </a>
              ) : null}
              <p>
                {resource.payload.page_index
                  .map((item) => `P${item.page} ${item.label}`)
                  .join(" · ")}
              </p>
              <button type="button" onClick={() => void rename(resource)}>
                重命名
              </button>
            </article>
          ))}
          {visibleResources.length === 0 ? (
            <p className="empty-state">暂无资料。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
