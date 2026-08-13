"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  AttachmentQueueRepository,
  BootstrapRepository,
  noteDocumentStateId,
  OfflineStorageError,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
  YjsNoteRepository,
  type JsonObject,
  type AttachmentQueueEntry,
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
import { InlineFormFeedback } from "@/components/product/inline-form-feedback";
import {
  deriveProductWorkbenchState,
  ProductWorkbenchStateNotice,
} from "@/components/product/product-workbench-state";
import { AppIcon } from "@/components/app-shell/app-icon";
import { DeskSubviewNav } from "@/components/desk/desk-subview-nav";
import { useSession } from "@/features/auth/session-provider";
import {
  offlineCapabilityMessage,
  offlineUnlockMessage,
} from "@/features/offline/offline-error-message";
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
  const [unlockPending, setUnlockPending] = useState(false);
  const [unlockFeedback, setUnlockFeedback] = useState<{
    message: string;
    tone: "error" | "loading" | "success";
  } | null>(null);
  const [notes, setNotes] = useState<View<NotePayload>[]>([]);
  const [resources, setResources] = useState<View<ResourcePayload>[]>([]);
  const [attachments, setAttachments] = useState<AttachmentQueueEntry[]>([]);
  const [resourceType, setResourceType] = useState<"link" | "pdf_index">(
    "link",
  );
  const [query, setQuery] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [recordKind, setRecordKind] = useState<
    "all" | "attachment" | "link" | "note" | "pdf_index"
  >("all");
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");

  const load = useCallback(async () => {
    setContextPhase("loading");
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
      setContextPhase("ready");
    } catch (error) {
      setStatus(userMessage(error));
      setContextPhase("error");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!workspaceId) return;
    queueMicrotask(() => {
      setContextPhase("loading");
      void browserApiClient
        .request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${workspaceId}/spaces`,
        )
        .then((result) => {
          setSpaces(result.spaces);
          setSpaceId(result.spaces[0]?.id ?? "");
          setContextPhase("ready");
        })
        .catch((error: unknown) => {
          setSpaces([]);
          setSpaceId("");
          setContextPhase("error");
          setStatus(userMessage(error));
        });
    });
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
    setDataPhase("loading");
    const [noteRows, resourceRows, attachmentRows] = await Promise.all([
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "note"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "resource"])
        .toArray(),
      db.attachmentQueue.where("workspace_id").equals(workspaceId).toArray(),
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
    setAttachments(attachmentRows);
    setDataPhase("ready");
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const form = event.currentTarget;
    const passphrase = String(new FormData(form).get("passphrase") ?? "");
    if (passphrase.length < 10) {
      const message = "本地口令至少需要 10 个字符。";
      setStatus(message);
      setUnlockFeedback({ message, tone: "error" });
      return;
    }
    setUnlockPending(true);
    setUnlockFeedback({ message: "正在解锁本地资料…", tone: "loading" });
    try {
      const { database: db, vault: localVault } = await unlockVault(passphrase);
      await bootstrap(db, localVault);
      await refresh(db, localVault);
      const message =
        "已在应用内解锁。Markdown 只按纯文本预览，不执行其中的 HTML。";
      setStatus(message);
      setUnlockFeedback({ message, tone: "success" });
      form.reset();
    } catch (error) {
      const message = offlineUnlockMessage(error) ?? userMessage(error);
      setStatus(message);
      setUnlockFeedback({ message, tone: "error" });
    } finally {
      setUnlockPending(false);
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
          .catch((error: unknown) => {
            setDataPhase("error");
            setStatus(userMessage(error));
          }),
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
        const entityId = note?.entity.entity_id ?? crypto.randomUUID();
        await commit(
          "note",
          entityId,
          {
            space_id: spaceId,
            task_id: note?.payload.task_id ?? null,
            title,
            markdown_body: markdown,
          },
          note?.entity,
        );
        if (!note) setSelectedRecordId(entityId);
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

  async function queueAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const db = database.current;
    if (db === null || !workspaceId || !spaceId || !deviceId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("attachment");
    const noteId = String(data.get("note_id") ?? "");
    if (!(file instanceof File) || file.size === 0 || !noteId) {
      setStatus("请选择已有笔记和一个受支持的附件。");
      return;
    }
    try {
      await new AttachmentQueueRepository(db).enqueue({
        attachment_id: crypto.randomUUID(),
        blob: file,
        device_id: deviceId,
        filename: file.name,
        media_type: file.type,
        space_id: spaceId,
        target_id: noteId,
        target_type: "note",
        workspace_id: workspaceId,
      });
      form.reset();
      setStatus("附件已进入真实上传队列；可在同步中心上传并完成哈希验证。");
      await refresh(db, vault.current);
    } catch (error) {
      setStatus(userMessage(error));
    }
  }

  const visibleNotes = notes.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleResources = resources.filter(
    (item) => item.payload.space_id === spaceId,
  );
  const visibleAttachments = attachments.filter(
    (item) => item.space_id === spaceId,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (value: string) =>
    normalizedQuery === "" ||
    value.toLocaleLowerCase().includes(normalizedQuery);
  const filteredNotes = visibleNotes.filter(
    (item) =>
      (recordKind === "all" || recordKind === "note") &&
      matchesQuery(`${item.payload.title} ${item.payload.markdown_body}`),
  );
  const filteredResources = visibleResources.filter(
    (item) =>
      (recordKind === "all" || recordKind === item.payload.resource_type) &&
      matchesQuery(
        `${item.payload.title} ${item.payload.source_url ?? ""} ${item.payload.pdf_filename ?? ""}`,
      ),
  );
  const filteredAttachments = visibleAttachments.filter(
    (item) =>
      (recordKind === "all" || recordKind === "attachment") &&
      matchesQuery(item.filename),
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
  const explicitlySelectedNote = filteredNotes.find(
    (item) => item.entity.entity_id === selectedRecordId,
  );
  const explicitlySelectedResource = filteredResources.find(
    (item) => item.entity.entity_id === selectedRecordId,
  );
  const selectedNote =
    selectedRecordId === "new"
      ? undefined
      : (explicitlySelectedNote ??
        (explicitlySelectedResource ? undefined : filteredNotes.at(-1)));
  const selectedResource =
    selectedRecordId === "new" || selectedNote
      ? undefined
      : (explicitlySelectedResource ?? filteredResources.at(-1));
  const creatingNote =
    selectedRecordId === "new" || (!selectedNote && !selectedResource);
  const contentState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(workspaceId && spaceId),
    hasData:
      visibleNotes.length +
        visibleResources.length +
        visibleAttachments.length >
      0,
    stale:
      [...visibleNotes, ...visibleResources].some(
        (item) => item.entity.sync_status !== "clean",
      ) || visibleAttachments.some((item) => item.state !== "verified"),
    unlocked,
  });
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

      <DeskSubviewNav
        activePath="/app/records"
        ariaLabel="知识库视图"
        items={[
          { href: "/app/records", icon: "files", label: "来源与记录" },
          { href: "/app/review", icon: "refresh", label: "复习与图谱" },
          { href: "/app/spaces", icon: "folder", label: "知识库管理" },
        ]}
      />

      <ProductWorkbenchStateNotice
        action={
          contentState === "locked" ? (
            <a className="product-action-link" href="#records-vault">
              解锁本地资料
            </a>
          ) : contentState === "empty" ? (
            <a className="product-action-link primary" href="#new-note">
              创建第一篇笔记
            </a>
          ) : (
            <a className="product-action-link" href="#records-vault">
              选择工作区与 Space
            </a>
          )
        }
        emptyDescription="当前 Space 尚无笔记、资料索引或附件；可以从一篇 Markdown 笔记开始。"
        emptyTitle="当前 Space 还是空资料库"
        onRetry={() => void load()}
        state={contentState}
      />

      <ProductDisclosure
        id="records-vault"
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
        <form
          aria-busy={unlockPending}
          className="inline-form"
          noValidate
          onSubmit={unlock}
        >
          <label htmlFor="content-passphrase">本地口令</label>
          <input
            aria-describedby={
              unlockFeedback?.tone === "error"
                ? "content-unlock-feedback"
                : undefined
            }
            aria-invalid={unlockFeedback?.tone === "error"}
            id="content-passphrase"
            name="passphrase"
            type="password"
            minLength={10}
            required
          />
          <button disabled={unlockPending} type="submit">
            {unlockPending ? "正在解锁…" : unlocked ? "重新解锁" : "解锁资料"}
          </button>
          {unlockFeedback ? (
            <InlineFormFeedback
              id="content-unlock-feedback"
              tone={unlockFeedback.tone}
            >
              {unlockFeedback.message}
            </InlineFormFeedback>
          ) : null}
        </form>
      </ProductDisclosure>

      <section className="product-records-summary" aria-label="资料库概览">
        <article>
          <span>Markdown 笔记</span>
          <strong>{visibleNotes.length}</strong>
          <small>{noteCharacters} 个字符</small>
        </article>
        <article>
          <span>资料与附件</span>
          <strong>{visibleResources.length + visibleAttachments.length}</strong>
          <small>
            {visibleResources.length} 份索引 · {visibleAttachments.length}{" "}
            个附件
          </small>
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

      <div className="library-toolbar" role="search">
        <label className="sr-only" htmlFor="records-search">
          搜索资料、笔记或附件
        </label>
        <input
          id="records-search"
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、正文、来源或文件名…"
        />
        <label className="sr-only" htmlFor="records-kind">
          资料类型
        </label>
        <select
          id="records-kind"
          value={recordKind}
          onChange={(event) =>
            setRecordKind(event.target.value as typeof recordKind)
          }
        >
          <option value="all">全部类型</option>
          <option value="note">Markdown 笔记</option>
          <option value="link">外部链接</option>
          <option value="pdf_index">PDF 索引</option>
          <option value="attachment">附件</option>
        </select>
      </div>

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
            {filteredNotes
              .slice(-6)
              .reverse()
              .map((note) => (
                <button
                  aria-pressed={
                    selectedNote?.entity.entity_id === note.entity.entity_id
                  }
                  className="product-record-row"
                  key={note.entity.entity_id}
                  type="button"
                  onClick={() => setSelectedRecordId(note.entity.entity_id)}
                >
                  <span aria-hidden="true">
                    <AppIcon name="book-open" size={16} />
                  </span>
                  <span>
                    <strong>{note.payload.title}</strong>
                    <small>{note.payload.markdown_body.length} 个字符</small>
                  </span>
                </button>
              ))}
            {filteredNotes.length === 0 ? (
              <p className="product-muted-note">当前筛选下没有笔记。</p>
            ) : null}
          </div>
          <div className="product-records-group">
            <h3>资料</h3>
            {filteredResources
              .slice(-6)
              .reverse()
              .map((resource) => (
                <button
                  aria-pressed={
                    selectedResource?.entity.entity_id ===
                    resource.entity.entity_id
                  }
                  className="product-record-row"
                  key={resource.entity.entity_id}
                  type="button"
                  onClick={() => setSelectedRecordId(resource.entity.entity_id)}
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
                </button>
              ))}
            {filteredResources.length === 0 ? (
              <p className="product-muted-note">当前筛选下没有资料索引。</p>
            ) : null}
          </div>
        </ProductPanel>

        <ProductPanel
          id="new-note"
          className="product-form-panel product-records-editor"
          title={
            creatingNote
              ? "新建 Markdown 笔记"
              : (selectedNote?.payload.title ??
                selectedResource?.payload.title ??
                "记录阅读器")
          }
          description={
            creatingNote
              ? "从一个问题开始，用标题、列表、引用和代码块组织理解。"
              : "查看当前 Space 中选中记录的正文、来源与同步状态。"
          }
          aside={
            <ProductTag
              tone={
                creatingNote
                  ? unlocked
                    ? "good"
                    : "warn"
                  : (selectedNote ?? selectedResource)?.entity.sync_status ===
                      "clean"
                    ? "good"
                    : "warn"
              }
            >
              {creatingNote
                ? unlocked
                  ? "可以保存"
                  : "请先解锁"
                : (selectedNote ?? selectedResource)?.entity.sync_status ===
                    "clean"
                  ? "已同步"
                  : "本地变更"}
            </ProductTag>
          }
        >
          {creatingNote ? (
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
          ) : selectedNote ? (
            <article className="product-record-reader" aria-label="选中笔记">
              <div className="product-record-reader-meta">
                <ProductTag tone="info">Markdown</ProductTag>
                <span>{selectedNote.payload.markdown_body.length} 个字符</span>
              </div>
              <ProductMarkdownPreview
                value={selectedNote.payload.markdown_body}
              />
              <button type="button" onClick={() => setSelectedRecordId("new")}>
                <AppIcon name="plus" size={16} />
                新建笔记
              </button>
            </article>
          ) : selectedResource ? (
            <article className="product-record-reader" aria-label="选中资料">
              <div className="product-record-reader-meta">
                <ProductTag tone="info">
                  {selectedResource.payload.resource_type === "link"
                    ? "外部链接"
                    : "PDF 索引"}
                </ProductTag>
                <span>
                  {selectedResource.payload.page_count
                    ? `${selectedResource.payload.page_count} 页`
                    : "来源索引"}
                </span>
              </div>
              {safeExternalUrl(selectedResource.payload.source_url) ? (
                <a
                  href={
                    safeExternalUrl(selectedResource.payload.source_url) ??
                    undefined
                  }
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  打开原始来源
                </a>
              ) : (
                <p className="product-muted-note">
                  当前资料没有可打开的来源地址。
                </p>
              )}
              {selectedResource.payload.page_index.length ? (
                <dl className="product-record-page-index">
                  {selectedResource.payload.page_index.map((entry) => (
                    <div key={`${entry.page}-${entry.label}`}>
                      <dt>第 {entry.page} 页</dt>
                      <dd>{entry.label || entry.note || "已建立页码索引"}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <button type="button" onClick={() => setSelectedRecordId("new")}>
                <AppIcon name="plus" size={16} />
                新建笔记
              </button>
            </article>
          ) : null}
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

      <ProductDisclosure
        summary="添加笔记附件"
        description="支持 PNG、JPEG 与纯文本；先进入本地队列，再由同步中心上传并校验哈希"
      >
        <form className="planning-form" onSubmit={queueAttachment}>
          <label htmlFor="attachment-note">关联笔记</label>
          <select id="attachment-note" name="note_id" required>
            {visibleNotes.map((note) => (
              <option key={note.entity.entity_id} value={note.entity.entity_id}>
                {note.payload.title}
              </option>
            ))}
          </select>
          <label htmlFor="attachment-file">附件</label>
          <input
            id="attachment-file"
            name="attachment"
            type="file"
            accept="image/png,image/jpeg,text/plain"
            required
          />
          <button
            type="submit"
            disabled={!unlocked || visibleNotes.length === 0}
          >
            加入附件队列
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
          {filteredNotes.map((note) => (
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
          {filteredNotes.length === 0 ? (
            <ProductEmptyState
              icon="✎"
              title="当前筛选下没有笔记"
              description="调整搜索条件，或从上方编辑器创建第一篇笔记。"
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
          {filteredResources.map((resource) => (
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
          {filteredResources.length === 0 ? (
            <ProductEmptyState
              icon="↗"
              title="当前筛选下没有外部资料"
              description="调整搜索条件，或保存一条可信链接与 PDF 页码索引。"
            />
          ) : null}
        </div>
      </ProductPanel>

      <ProductPanel
        className="sync-wide-card"
        title="附件队列"
        description="附件状态来自本地真实队列；上传、重试与服务器哈希验证统一在同步中心完成。"
        aside={<ProductTag>{filteredAttachments.length} 项</ProductTag>}
      >
        <div className="content-grid">
          {filteredAttachments.map((attachment) => (
            <article className="task-card" key={attachment.attachment_id}>
              <h3>{attachment.filename}</h3>
              <p>
                {attachment.media_type} · {attachment.byte_size} bytes
              </p>
              <p>状态：{attachment.state}</p>
              <small>{attachment.sha256}</small>
            </article>
          ))}
          {filteredAttachments.length === 0 ? (
            <ProductEmptyState
              description="为已有笔记添加 PNG、JPEG 或纯文本附件后，真实队列会显示在这里。"
              title="当前筛选下没有附件"
            />
          ) : null}
        </div>
        <a className="product-action-link" href="/app/sync">
          前往同步中心处理附件
        </a>
      </ProductPanel>
    </main>
  );
}
