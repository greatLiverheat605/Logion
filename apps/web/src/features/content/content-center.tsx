"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  noteDocumentStateId,
  OfflineStorageError,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
  YjsNoteRepository,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "@logion/offline";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ProductDisclosure,
  ProductEmptyState,
  ProductMarkdownPreview,
  ProductPageHeader,
  ProductPanel,
  ProductTag,
  ProductTaskRow,
} from "@/components/product/product-ui";
import { AppIcon } from "@/components/app-shell/app-icon";
import { useSession } from "@/features/auth/session-provider";
import { offlineCapabilityMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
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
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null) return capabilityMessage;
  if (error instanceof LogionApiError) {
    return `操作未完成（请求编号：${error.requestId}）`;
  }
  if (error instanceof OfflineStorageError) {
    return "本地资料操作未完成；未确认写入的数据不会标记为已保存。";
  }
  return "操作未完成，请检查网络与本地资料状态后重试。";
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
  const [status, setStatus] = useState("正在准备记录与资料库……");
  const [notes, setNotes] = useState<View<NotePayload>[]>([]);
  const [resources, setResources] = useState<View<ResourcePayload>[]>([]);
  const [resourceType, setResourceType] = useState<"link" | "pdf_index">(
    "link",
  );

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
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase") ?? "",
      );
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      setStatus("已在应用内解锁。Markdown 只按纯文本预览，不执行其中的 HTML。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(userMessage(error));
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
            setStatus("本地资料已在应用内解锁；Markdown 预览不会执行 HTML。"),
          )
          .catch((error: unknown) => setStatus(userMessage(error))),
    );
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId]);

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
  const noteCharacters = visibleNotes.reduce(
    (total, item) => total + item.payload.markdown_body.length,
    0,
  );
  const indexedPages = visibleResources.reduce(
    (total, item) => total + item.payload.page_index.length,
    0,
  );
  const latestNote = visibleNotes.at(-1);
  return (
    <main id="main-content" className="settings-page content-page">
      <ProductPageHeader
        eyebrow="RECORDS · MARKDOWN WORKBENCH"
        title="资料与笔记"
        description={
          <>
            <p>
              在同一工作台中管理资料、书写 Markdown，并用安全预览检查内容结构。
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
        actions={
          <button
            type="button"
            disabled={!unlocked}
            onClick={() => void synchronize()}
          >
            <AppIcon name="refresh" size={16} />
            立即同步
          </button>
        }
      />

      <ProductDisclosure
        summary="资料库位置与本地解锁"
        description="选择工作区、空间并解锁端侧加密内容"
        defaultOpen={!unlocked}
      >
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
          <button type="submit">{unlocked ? "重新解锁" : "解锁资料"}</button>
        </form>
      </ProductDisclosure>

      <section className="product-records-summary" aria-label="资料库概览">
        <article>
          <span>Markdown 笔记</span>
          <strong>{visibleNotes.length}</strong>
          <small>{noteCharacters} 个字符</small>
        </article>
        <article>
          <span>外部资料</span>
          <strong>{visibleResources.length}</strong>
          <small>链接与索引</small>
        </article>
        <article>
          <span>PDF 索引页</span>
          <strong>{indexedPages}</strong>
          <small>不上传 PDF 正文</small>
        </article>
        <article>
          <span>最近编辑</span>
          <strong>{latestNote?.payload.title ?? "暂无笔记"}</strong>
          <small>{unlocked ? "本地资料已解锁" : "等待本地解锁"}</small>
        </article>
      </section>

      <div className="product-records-workbench">
        <ProductPanel
          className="product-records-library"
          title="知识库"
          description="当前空间中的笔记与资料索引。"
          aside={
            <ProductTag>
              {visibleNotes.length + visibleResources.length} 项
            </ProductTag>
          }
        >
          <div className="product-records-group">
            <h3>笔记</h3>
            {visibleNotes
              .slice(-6)
              .reverse()
              .map((note) => (
                <div className="product-record-row" key={note.entity.entity_id}>
                  <span aria-hidden="true">
                    <AppIcon name="book-open" size={16} />
                  </span>
                  <span>
                    <strong>{note.payload.title}</strong>
                    <small>{note.payload.markdown_body.length} 个字符</small>
                  </span>
                </div>
              ))}
            {visibleNotes.length === 0 ? (
              <p className="product-muted-note">还没有笔记。</p>
            ) : null}
          </div>
          <div className="product-records-group">
            <h3>资料</h3>
            {visibleResources
              .slice(-6)
              .reverse()
              .map((resource) => (
                <div
                  className="product-record-row"
                  key={resource.entity.entity_id}
                >
                  <span aria-hidden="true">
                    <AppIcon name="files" size={16} />
                  </span>
                  <span>
                    <strong>{resource.payload.title}</strong>
                    <small>
                      {resource.payload.resource_type === "link"
                        ? "外部链接"
                        : "PDF 索引"}
                    </small>
                  </span>
                </div>
              ))}
            {visibleResources.length === 0 ? (
              <p className="product-muted-note">还没有资料索引。</p>
            ) : null}
          </div>
        </ProductPanel>

        <ProductPanel
          className="product-form-panel product-records-editor"
          title="新建 Markdown 笔记"
          description="从一个问题开始，用标题、列表、引用和代码块组织理解。"
          aside={
            <ProductTag tone={unlocked ? "good" : "warn"}>
              {unlocked ? "可以保存" : "请先解锁"}
            </ProductTag>
          }
        >
          <form
            className="planning-form product-editor-form"
            onSubmit={(event) => void saveNote(event)}
          >
            <label htmlFor="note-title">标题</label>
            <input id="note-title" name="title" maxLength={200} required />
            <label htmlFor="note-body">正文</label>
            <div
              className="product-editor-toolbar"
              aria-label="支持的 Markdown 语法"
            >
              <span>H1</span>
              <span>H2</span>
              <span>• 列表</span>
              <span>“ 引用</span>
              <span>{`</>`} 代码</span>
            </div>
            <textarea
              id="note-body"
              name="markdown_body"
              maxLength={500000}
              placeholder={
                "# 核心问题\n\n## 我的理解\n\n- 关键概念\n- 证据与例子\n\n> 下一步要验证什么？"
              }
            />
            <button type="submit" disabled={!unlocked}>
              保存笔记到本地
            </button>
          </form>
        </ProductPanel>

        <ProductPanel
          className="product-records-outline"
          title="写作提纲"
          description="让每篇记录都能回到问题、证据和下一步。"
        >
          <div className="product-task-list">
            <ProductTaskRow
              icon="01"
              title="核心问题"
              description="这篇笔记要回答什么"
            />
            <ProductTaskRow
              icon="02"
              title="我的理解"
              description="拆分概念与推理过程"
            />
            <ProductTaskRow
              icon="03"
              title="证据来源"
              description="连接资料或 PDF 页码"
            />
            <ProductTaskRow
              icon="04"
              title="下一步"
              description="留下待验证的问题"
            />
          </div>
          <div className="product-writing-tip">
            <AppIcon name="ai" size={17} />
            <p>当前版本只提供结构提示，不会自动读取或改写你的私有笔记。</p>
          </div>
        </ProductPanel>
      </div>

      <ProductDisclosure
        summary="登记外部资料"
        description="保存安全链接或 PDF 页码索引，不上传 PDF 正文"
      >
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
      </ProductDisclosure>

      <ProductPanel
        className="sync-wide-card"
        title="笔记工作区"
        description="编辑已保存内容，并在旁侧查看不执行 HTML 的安全 Markdown 预览。"
        aside={<ProductTag tone="info">{visibleNotes.length} 篇</ProductTag>}
      >
        <div className="content-grid">
          {visibleNotes.map((note) => (
            <article
              className="task-card product-note-workbench"
              key={note.entity.entity_id}
            >
              <form
                className="planning-form product-editor-form"
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
                <div
                  className="product-editor-toolbar"
                  aria-label="支持的 Markdown 语法"
                >
                  <span>H1</span>
                  <span>H2</span>
                  <span>• 列表</span>
                  <span>“ 引用</span>
                  <span>{`</>`} 代码</span>
                </div>
                <textarea
                  id={`body-${note.entity.entity_id}`}
                  name="markdown_body"
                  defaultValue={note.payload.markdown_body}
                />
                <button type="submit">保存修改</button>
              </form>
              <section
                className="product-note-preview"
                aria-label={`${note.payload.title} 安全预览`}
              >
                <header>
                  <span>安全预览</span>
                  <small>HTML 不执行</small>
                </header>
                <ProductMarkdownPreview value={note.payload.markdown_body} />
              </section>
            </article>
          ))}
          {visibleNotes.length === 0 ? (
            <ProductEmptyState
              icon="✎"
              title="资料库中还没有笔记"
              description="从上方编辑器创建第一篇，建议从一个正在解决的问题开始。"
            />
          ) : null}
        </div>
      </ProductPanel>

      <ProductPanel
        className="sync-wide-card"
        title="资料索引"
        description="集中查看外部来源和 PDF 页码定位。"
        aside={<ProductTag>{visibleResources.length} 项</ProductTag>}
      >
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
            <ProductEmptyState
              icon="↗"
              title="尚未登记外部资料"
              description="保存一条可信链接，或为本地 PDF 建立页码索引。"
            />
          ) : null}
        </div>
      </ProductPanel>
    </main>
  );
}
