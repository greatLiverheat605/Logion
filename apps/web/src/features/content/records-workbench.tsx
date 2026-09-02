"use client";

import {
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchDropdownMenu,
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import {
  ProductMarkdownPreview,
  ProductTag,
} from "@/components/product/product-ui";
import { ProductOperationalStateNotice } from "@/components/product/product-workbench-state";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";

import styles from "./records-workbench.module.css";
import {
  filterRecords,
  safeRecordsExternalUrl,
  type RecordsControllerResult,
  type RecordsKind,
  type RecordsLocalView,
  type RecordsNotePayload,
  type RecordsResourcePayload,
} from "./use-records-controller";

const KIND_OPTIONS: ReadonlyArray<{ label: string; value: RecordsKind }> = [
  { label: "全部", value: "all" },
  { label: "笔记", value: "note" },
  { label: "链接", value: "link" },
  { label: "PDF", value: "pdf_index" },
  { label: "附件", value: "attachment" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function EmptyPane({
  description,
  title,
}: Readonly<{ description: string; title: string }>) {
  return (
    <div className={styles.emptyPane}>
      <span aria-hidden="true">
        <AppIcon name="book-open" size={20} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function KindSegment({
  kind,
  onChange,
}: Readonly<{
  kind: RecordsKind;
  onChange: (kind: RecordsKind) => void;
}>) {
  return (
    <div
      aria-label="记录类型"
      className={styles.segmented}
      data-testid="records-collections"
      role="radiogroup"
    >
      {KIND_OPTIONS.map((option) => (
        <button
          aria-checked={kind === option.value}
          className={kind === option.value ? styles.segmentActive : undefined}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ListSection({
  children,
  count,
  title,
}: Readonly<{ children: ReactNode; count: number; title: string }>) {
  return (
    <section className={styles.listSection}>
      <header>
        <h2>{title}</h2>
        <span>{count}</span>
      </header>
      {children}
    </section>
  );
}

function NoteList({
  controller,
  notes,
}: Readonly<{
  controller: RecordsControllerResult;
  notes: RecordsLocalView<RecordsNotePayload>[];
}>) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveSelection(index: number, direction: -1 | 1) {
    const nextIndex = Math.max(
      0,
      Math.min(notes.length - 1, index + direction),
    );
    const next = notes[nextIndex];
    rowRefs.current[nextIndex]?.focus();
    if (next) controller.commands.selectNote(next.entity.entity_id);
  }

  if (!notes.length) {
    return <p className={styles.listEmpty}>当前筛选下没有笔记。</p>;
  }

  return (
    <div aria-label="笔记列表" className={styles.objectList}>
      {notes.map((note, index) => {
        const active =
          note.entity.entity_id ===
          controller.viewModel.selectedNote?.entity.entity_id;
        return (
          <button
            aria-current={active ? "true" : undefined}
            aria-label={`${note.payload.title}，更新于 ${formatDate(note.entity.updated_at)}`}
            className={`${styles.objectRow} ${active ? styles.objectRowActive : ""}`}
            key={note.entity.entity_id}
            onClick={() =>
              controller.commands.selectNote(note.entity.entity_id)
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(index, event.key === "ArrowDown" ? 1 : -1);
              }
            }}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            type="button"
          >
            <span aria-hidden="true" className={styles.objectIcon}>
              <AppIcon name="files" size={15} />
            </span>
            <span className={styles.objectCopy}>
              <strong>{note.payload.title}</strong>
              <small>更新 {formatDate(note.entity.updated_at)}</small>
              <span className={styles.rowTags}>
                {note.entity.sync_status === "clean" ? null : (
                  <ProductTag tone="info">待同步</ProductTag>
                )}
                {note.payload.task_id ? (
                  <ProductTag>已关联任务</ProductTag>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ResourceList({
  onRename,
  resources,
}: Readonly<{
  onRename: (resource: RecordsLocalView<RecordsResourcePayload>) => void;
  resources: RecordsLocalView<RecordsResourcePayload>[];
}>) {
  if (!resources.length) {
    return <p className={styles.listEmpty}>当前筛选下没有外部资料。</p>;
  }

  return (
    <div aria-label="外部资料列表" className={styles.objectList}>
      {resources.map((resource) => {
        const externalUrl = safeRecordsExternalUrl(resource.payload.source_url);
        const metadata =
          resource.payload.resource_type === "link"
            ? externalUrl
            : `${resource.payload.pdf_filename ?? "PDF"} · ${resource.payload.page_index
                .map((item) => `P${item.page}`)
                .join("、")}`;
        return (
          <article
            className={styles.resourceRow}
            key={resource.entity.entity_id}
          >
            <span aria-hidden="true" className={styles.objectIcon}>
              <AppIcon
                name={
                  resource.payload.resource_type === "link"
                    ? "book-open"
                    : "folder"
                }
                size={15}
              />
            </span>
            <span className={styles.objectCopy}>
              <strong>{resource.payload.title}</strong>
              <small className={styles.longToken}>{metadata}</small>
            </span>
            <div className={styles.rowActions}>
              {externalUrl ? (
                <WorkbenchTooltip content="打开外部资料">
                  <a
                    aria-label={`打开 ${resource.payload.title}`}
                    className={styles.iconButton}
                    href={externalUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    <AppIcon name="book-open" size={15} />
                  </a>
                </WorkbenchTooltip>
              ) : null}
              <WorkbenchTooltip content="重命名资料">
                <button
                  aria-label={`重命名 ${resource.payload.title}`}
                  className={styles.iconButton}
                  onClick={() => onRename(resource)}
                  type="button"
                >
                  <AppIcon name="more" size={15} />
                </button>
              </WorkbenchTooltip>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AttachmentList({
  attachments,
}: Readonly<{
  attachments: RecordsControllerResult["viewModel"]["attachments"];
}>) {
  if (!attachments.length) {
    return (
      <p className={styles.listEmpty} data-testid="records-attachments">
        当前筛选下没有附件。
      </p>
    );
  }

  return (
    <div
      aria-label="附件队列"
      className={styles.objectList}
      data-testid="records-attachments"
    >
      {attachments.map((attachment) => (
        <article className={styles.resourceRow} key={attachment.attachment_id}>
          <span aria-hidden="true" className={styles.objectIcon}>
            <AppIcon name="archive" size={15} />
          </span>
          <span className={styles.objectCopy}>
            <strong>{attachment.filename}</strong>
            <small>
              {formatBytes(attachment.byte_size)} · {attachment.media_type}
            </small>
            <small className={styles.longToken}>{attachment.sha256}</small>
          </span>
          <ProductTag
            tone={
              attachment.state === "verified"
                ? "good"
                : attachment.state === "failed"
                  ? "bad"
                  : "warn"
            }
          >
            {attachment.state === "verified"
              ? "已验证"
              : attachment.state === "failed"
                ? "失败"
                : attachment.state === "uploading"
                  ? "上传中"
                  : "排队中"}
          </ProductTag>
        </article>
      ))}
    </div>
  );
}

function MasterPane({
  controller,
  filtered,
  kind,
  onKindChange,
  onQueryChange,
  onRename,
  query,
}: Readonly<{
  controller: RecordsControllerResult;
  filtered: ReturnType<typeof filterRecords>;
  kind: RecordsKind;
  onKindChange: (kind: RecordsKind) => void;
  onQueryChange: (query: string) => void;
  onRename: (resource: RecordsLocalView<RecordsResourcePayload>) => void;
  query: string;
}>) {
  return (
    <aside
      aria-label="文档树与对象列表"
      className={`${styles.masterPane} workbench-master`}
      data-testid="workbench-master"
    >
      <div data-testid="records-tree">
        <div className={styles.masterControls}>
          <KindSegment kind={kind} onChange={onKindChange} />
          <label className={styles.searchField}>
            <span className="sr-only">搜索笔记、资料或附件</span>
            <AppIcon name="search" size={15} />
            <input
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索当前 Space"
              type="search"
              value={query}
            />
          </label>
        </div>
        {(kind === "all" || kind === "note") && (
          <ListSection count={filtered.notes.length} title="笔记">
            <NoteList controller={controller} notes={filtered.notes} />
          </ListSection>
        )}
        {(kind === "all" || kind === "link" || kind === "pdf_index") && (
          <ListSection count={filtered.resources.length} title="外部资料">
            <ResourceList onRename={onRename} resources={filtered.resources} />
          </ListSection>
        )}
        {(kind === "all" || kind === "attachment") && (
          <ListSection count={filtered.attachments.length} title="附件队列">
            <AttachmentList attachments={filtered.attachments} />
          </ListSection>
        )}
      </div>
    </aside>
  );
}

function EditorMode({
  mode,
  onChange,
}: Readonly<{
  mode: "edit" | "preview";
  onChange: (mode: "edit" | "preview") => void;
}>) {
  return (
    <div
      aria-label="编辑器模式"
      className={styles.editorMode}
      role="radiogroup"
    >
      {(["edit", "preview"] as const).map((value) => (
        <button
          aria-checked={mode === value}
          className={mode === value ? styles.editorModeActive : undefined}
          key={value}
          onClick={() => onChange(value)}
          role="radio"
          type="button"
        >
          {value === "edit" ? "编辑" : "安全预览"}
        </button>
      ))}
    </div>
  );
}

function NoteEditor({
  controller,
  note,
}: Readonly<{
  controller: RecordsControllerResult;
  note: RecordsLocalView<RecordsNotePayload>;
}>) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [title, setTitle] = useState(note.payload.title);
  const [markdownBody, setMarkdownBody] = useState(note.payload.markdown_body);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const changed =
    dirty &&
    (title !== note.payload.title ||
      markdownBody !== note.payload.markdown_body);

  async function save() {
    setPending(true);
    const saved = await controller.commands.saveNote(note.entity.entity_id, {
      markdownBody,
      title,
    });
    setPending(false);
    if (saved) setDirty(false);
  }

  return (
    <section
      aria-label="Markdown 编辑器"
      className={styles.editorPane}
      data-testid="records-editor"
    >
      <WorkbenchToolbar label="编辑器操作">
        <EditorMode mode={mode} onChange={setMode} />
        <span className={styles.editorMeta}>
          单条笔记上限 500 KB · revision {note.entity.local_revision}
        </span>
        <span className={styles.toolbarSpacer} />
        <span data-testid="records-save-status">
          <ProductTag tone={changed ? "warn" : "good"}>
            {pending ? "正在保存" : changed ? "未保存" : "已保存"}
          </ProductTag>
        </span>
        <button
          className={styles.saveButton}
          disabled={!changed || pending || !controller.capabilities.canWrite}
          onClick={() => void save()}
          type="button"
        >
          {pending ? "保存中" : "保存"}
        </button>
      </WorkbenchToolbar>
      <div className={styles.editorSurface}>
        <label className="sr-only" htmlFor="records-note-title">
          笔记标题
        </label>
        <input
          className={styles.editorTitle}
          id="records-note-title"
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          readOnly={!controller.capabilities.canWrite}
          value={title}
        />
        {mode === "edit" ? (
          <>
            <label className="sr-only" htmlFor="records-note-body">
              Markdown 正文
            </label>
            <textarea
              className={styles.editorBody}
              id="records-note-body"
              maxLength={500000}
              onChange={(event) => {
                setMarkdownBody(event.target.value);
                setDirty(true);
              }}
              readOnly={!controller.capabilities.canWrite}
              spellCheck={false}
              value={markdownBody}
            />
          </>
        ) : (
          <div className={styles.previewBody}>
            <ProductMarkdownPreview value={markdownBody} />
            <p className={styles.previewNotice}>
              <AppIcon name="shield" size={14} />
              安全预览只渲染 Markdown 结构，正文中的 HTML 不执行。
            </p>
          </div>
        )}
      </div>
      {!controller.context.online && changed ? (
        <p className={styles.offlineNote} role="status">
          离线保存会把修改写入本机 IndexedDB 与 Outbox；恢复网络后再推送。
        </p>
      ) : null}
    </section>
  );
}

function Inspector({
  controller,
  note,
  onAddAttachment,
}: Readonly<{
  controller: RecordsControllerResult;
  note: RecordsLocalView<RecordsNotePayload> | null;
  onAddAttachment: () => void;
}>) {
  if (!note) {
    return (
      <aside
        aria-label="元数据与关联检查器"
        className={`${styles.inspectorPane} workbench-inspector`}
        data-testid="workbench-inspector"
      >
        <div data-testid="records-inspector">
          <EmptyPane
            description="选择笔记后，这里显示 revision、同步状态、任务关联和附件操作。"
            title="暂无选中对象"
          />
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="元数据与关联检查器"
      className={`${styles.inspectorPane} workbench-inspector`}
      data-testid="workbench-inspector"
    >
      <div data-testid="records-inspector">
        <InspectorSection title="元数据">
          <dl className={styles.metadataList}>
            <div>
              <dt>更新于</dt>
              <dd>{formatDate(note.entity.updated_at)}</dd>
            </div>
            <div>
              <dt>本地 revision</dt>
              <dd>{note.entity.local_revision}</dd>
            </div>
            <div>
              <dt>服务端版本</dt>
              <dd>{note.entity.server_version}</dd>
            </div>
            <div>
              <dt>同步</dt>
              <dd>
                <ProductTag
                  tone={note.entity.sync_status === "clean" ? "good" : "warn"}
                >
                  {note.entity.sync_status === "clean" ? "已同步" : "待推送"}
                </ProductTag>
              </dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>
                {formatBytes(new Blob([note.payload.markdown_body]).size)} / 500
                KB
              </dd>
            </div>
          </dl>
        </InspectorSection>
        <InspectorSection title="关联对象">
          <div className={styles.relationBlock}>
            <span aria-hidden="true">
              <AppIcon name="target" size={16} />
            </span>
            <div>
              <strong>
                {note.payload.task_id ? "已关联任务" : "暂无任务引用"}
              </strong>
              <small className={styles.longToken}>
                {note.payload.task_id ?? "可从今日工作台把笔记用作证据来源。"}
              </small>
            </div>
          </div>
        </InspectorSection>
        <InspectorSection title="对象操作">
          <div className={styles.inspectorActions}>
            <button
              disabled={!controller.capabilities.canWrite}
              onClick={onAddAttachment}
              type="button"
            >
              <AppIcon name="archive" size={15} />
              添加附件
            </button>
            <button
              disabled={!controller.capabilities.canSync}
              onClick={() => void controller.commands.synchronize()}
              type="button"
            >
              <AppIcon name="refresh" size={15} />
              立即同步
            </button>
            <a href="/app/sync">打开同步中心</a>
          </div>
        </InspectorSection>
      </div>
    </aside>
  );
}

function ContextToolbar({
  controller,
  onUnlock,
}: Readonly<{
  controller: RecordsControllerResult;
  onUnlock: () => void;
}>) {
  return (
    <div className={styles.contextToolbar}>
      <WorkbenchSelect
        disabled={controller.context.workspaces.length === 0}
        label="选择 Workspace"
        onValueChange={controller.commands.setWorkspaceId}
        options={controller.context.workspaces.map((workspace) => ({
          label: workspace.name,
          value: workspace.id,
        }))}
        placeholder="选择 Workspace"
        value={controller.context.workspaceId || undefined}
      />
      <WorkbenchSelect
        disabled={controller.context.spaces.length === 0}
        label="选择 Space"
        onValueChange={controller.commands.setSpaceId}
        options={controller.context.spaces.map((space) => ({
          label: space.name,
          value: space.id,
        }))}
        placeholder="选择 Space"
        value={controller.context.spaceId || undefined}
      />
      <span className={styles.toolbarSpacer} />
      {!controller.context.unlocked ? (
        <button
          className={styles.secondaryButton}
          disabled={!controller.capabilities.canUnlock}
          id="records-unlock"
          onClick={onUnlock}
          type="button"
        >
          <AppIcon name="unlock" size={15} />
          解锁资料
        </button>
      ) : null}
      <WorkbenchTooltip content="同步当前 Workspace">
        <button
          aria-label="同步当前 Workspace"
          className={styles.iconButton}
          disabled={!controller.capabilities.canSync}
          onClick={() => void controller.commands.synchronize()}
          type="button"
        >
          <AppIcon name="refresh" size={16} />
        </button>
      </WorkbenchTooltip>
    </div>
  );
}

function NewNoteSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: RecordsControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) setTitle("");
    onOpenChange(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const noteId = await controller.commands.createNote({
      markdownBody: `# ${title.trim()}\n\n`,
      title,
    });
    setPending(false);
    if (noteId) changeOpen(false);
  }

  return (
    <WorkbenchSheet
      description="正文端侧加密；创建后直接在工作台继续编辑。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => changeOpen(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={!title.trim() || pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在创建" : "创建笔记"}
          </button>
        </>
      }
      onOpenChange={changeOpen}
      open={open}
      title="新建 Markdown 笔记"
      trigger={
        <button
          className={styles.primaryButton}
          data-workbench-primary={
            controller.capabilities.canCreate ? "true" : undefined
          }
          disabled={!controller.capabilities.canCreate}
          id="records-new-note"
          type="button"
        >
          <AppIcon name="plus" size={16} />
          新建笔记
        </button>
      }
    >
      <form className={styles.sheetForm} id={formId} onSubmit={submit}>
        <label htmlFor={`${formId}-title`}>标题</label>
        <input
          autoFocus
          id={`${formId}-title`}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：Raft 成员变更精读"
          required
          value={title}
        />
        <p>创建后会生成标题结构，并立即选中这篇笔记。</p>
      </form>
    </WorkbenchSheet>
  );
}

function ResourceSheet({
  controller,
  kind,
  onOpenChange,
}: Readonly<{
  controller: RecordsControllerResult;
  kind: "link" | "pdf_index" | null;
  onOpenChange: (kind: "link" | "pdf_index" | null) => void;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const close = () => onOpenChange(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    const saved = await controller.commands.createResource({
      label: String(data.get("label") ?? ""),
      note: String(data.get("note") ?? ""),
      page: Number(data.get("page") ?? 0),
      pageCount: Number(data.get("page_count") ?? 0),
      pdfFilename: String(data.get("pdf_filename") ?? ""),
      resourceType: kind,
      sourceUrl: String(data.get("source_url") ?? ""),
      title: String(data.get("title") ?? ""),
    });
    setPending(false);
    if (saved) close();
  }

  return (
    <WorkbenchSheet
      description={
        kind === "link"
          ? "只保存 HTTP(S) 地址与名称；外链以 noopener/noreferrer 打开。"
          : "只保存文件名和页码定位，不上传 PDF 正文，也不伪造文件哈希。"
      }
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={close}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在保存" : kind === "link" ? "保存链接" : "保存索引"}
          </button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open={kind !== null}
      title={kind === "link" ? "登记 HTTP(S) 链接" : "登记 PDF 页码索引"}
    >
      <form className={styles.sheetForm} id={formId} onSubmit={submit}>
        <label htmlFor={`${formId}-title`}>名称</label>
        <input
          autoFocus
          id={`${formId}-title`}
          maxLength={200}
          name="title"
          required
        />
        {kind === "link" ? (
          <>
            <label htmlFor={`${formId}-url`}>HTTP(S) 地址</label>
            <input
              id={`${formId}-url`}
              name="source_url"
              pattern="https?://.*"
              placeholder="https://"
              required
              type="url"
            />
          </>
        ) : (
          <>
            <label htmlFor={`${formId}-filename`}>PDF 文件名</label>
            <input id={`${formId}-filename`} name="pdf_filename" required />
            <div className={styles.fieldGrid}>
              <label>
                总页数
                <input min={1} name="page_count" required type="number" />
              </label>
              <label>
                索引页
                <input min={1} name="page" required type="number" />
              </label>
            </div>
            <label htmlFor={`${formId}-label`}>索引标签</label>
            <input id={`${formId}-label`} name="label" required />
            <label htmlFor={`${formId}-note`}>页码笔记</label>
            <textarea id={`${formId}-note`} name="note" rows={3} />
          </>
        )}
      </form>
    </WorkbenchSheet>
  );
}

function AttachmentSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: RecordsControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("attachment");
    if (!(file instanceof File)) return;
    setPending(true);
    const queued = await controller.commands.queueAttachment(
      String(data.get("note_id") ?? ""),
      file,
    );
    setPending(false);
    if (queued) onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="仅支持 PNG、JPEG 与纯文本；文件会计算真实 SHA-256 后进入本地队列。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending || controller.viewModel.notes.length === 0}
            form={formId}
            type="submit"
          >
            {pending ? "正在计算哈希" : "加入附件队列"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="添加笔记附件"
    >
      <form className={styles.sheetForm} id={formId} onSubmit={submit}>
        <label htmlFor={`${formId}-note`}>关联笔记</label>
        <select
          defaultValue={
            controller.viewModel.selectedNote?.entity.entity_id ?? ""
          }
          id={`${formId}-note`}
          name="note_id"
          required
        >
          {controller.viewModel.notes.map((note) => (
            <option key={note.entity.entity_id} value={note.entity.entity_id}>
              {note.payload.title}
            </option>
          ))}
        </select>
        <label htmlFor={`${formId}-file`}>附件</label>
        <input
          accept="image/png,image/jpeg,text/plain"
          id={`${formId}-file`}
          name="attachment"
          required
          type="file"
        />
      </form>
    </WorkbenchSheet>
  );
}

function UnlockSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: RecordsControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    setPending(true);
    const unlocked = await controller.commands.unlock(passphrase);
    setPending(false);
    if (unlocked) onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="口令只用于当前设备的本地加密资料，不会发送到服务器。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在解锁" : "解锁资料"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="解锁本地资料"
    >
      <form className={styles.sheetForm} id={formId} onSubmit={submit}>
        <label htmlFor={`${formId}-passphrase`}>本地口令</label>
        <input
          autoComplete="current-password"
          autoFocus
          id={`${formId}-passphrase`}
          minLength={10}
          name="passphrase"
          required
          type="password"
        />
      </form>
    </WorkbenchSheet>
  );
}

function RenameResourceSheet({
  controller,
  onOpenChange,
  resource,
}: Readonly<{
  controller: RecordsControllerResult;
  onOpenChange: (
    resource: RecordsLocalView<RecordsResourcePayload> | null,
  ) => void;
  resource: RecordsLocalView<RecordsResourcePayload> | null;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resource) return;
    setPending(true);
    const renamed = await controller.commands.renameResource(
      resource.entity.entity_id,
      String(new FormData(event.currentTarget).get("title") ?? ""),
    );
    setPending(false);
    if (renamed) onOpenChange(null);
  }

  return (
    <WorkbenchSheet
      description="只更新资料名称；来源地址、PDF 页码与同步语义保持不变。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(null)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在保存" : "保存名称"}
          </button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) onOpenChange(null);
      }}
      open={resource !== null}
      title="重命名资料"
    >
      {resource ? (
        <form className={styles.sheetForm} id={formId} onSubmit={submit}>
          <label htmlFor={`${formId}-title`}>资料名称</label>
          <input
            autoFocus
            defaultValue={resource.payload.title}
            id={`${formId}-title`}
            maxLength={200}
            name="title"
            required
          />
        </form>
      ) : null}
    </WorkbenchSheet>
  );
}

export function RecordsWorkbench({
  controller,
}: Readonly<{ controller: RecordsControllerResult }>) {
  const [kind, setKind] = useState<RecordsKind>("all");
  const [query, setQuery] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [resourceKind, setResourceKind] = useState<"link" | "pdf_index" | null>(
    null,
  );
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [renameResource, setRenameResource] =
    useState<RecordsLocalView<RecordsResourcePayload> | null>(null);
  const filtered = useMemo(
    () => filterRecords(controller.viewModel, kind, query),
    [controller.viewModel, kind, query],
  );
  const selectedNote = controller.viewModel.selectedNote;

  return (
    <main className={styles.root} id="main-content">
      <WorkbenchHeader
        actions={
          <>
            {controller.context.unlocked ? (
              <WorkbenchDropdownMenu
                align="end"
                items={[
                  {
                    disabled: !controller.capabilities.canCreate,
                    icon: <AppIcon name="book-open" size={15} />,
                    id: "link",
                    label: "HTTP(S) 链接",
                    onSelect: () => setResourceKind("link"),
                  },
                  {
                    disabled: !controller.capabilities.canCreate,
                    icon: <AppIcon name="folder" size={15} />,
                    id: "pdf",
                    label: "PDF 页码索引",
                    onSelect: () => setResourceKind("pdf_index"),
                  },
                ]}
                label="登记资料类型"
                trigger={
                  <button
                    className={styles.secondaryButton}
                    disabled={!controller.capabilities.canCreate}
                    type="button"
                  >
                    <AppIcon name="plus" size={15} />
                    登记资料
                    <AppIcon name="chevron-down" size={13} />
                  </button>
                }
              />
            ) : null}
            {controller.context.unlocked ? (
              <NewNoteSheet
                controller={controller}
                onOpenChange={setNewNoteOpen}
                open={newNoteOpen}
              />
            ) : (
              <button
                className={styles.primaryButton}
                data-workbench-primary={
                  controller.capabilities.canUnlock ? "true" : undefined
                }
                disabled={!controller.capabilities.canUnlock}
                onClick={() => setUnlockOpen(true)}
                type="button"
              >
                <AppIcon name="unlock" size={16} />
                解锁资料
              </button>
            )}
          </>
        }
        description={
          <>
            <span>Markdown 笔记与外部资料索引；正文端侧加密。</span>
            <small>安全预览永远不执行正文中的 HTML。</small>
          </>
        }
        eyebrow="RECORDS · NOTES & SOURCES"
        title="资料与笔记"
      />
      <WorkbenchContextBar context={controller.context.operational} />
      <ContextToolbar
        controller={controller}
        onUnlock={() => setUnlockOpen(true)}
      />
      <p aria-live="polite" className={styles.statusLine} role="status">
        {controller.context.status}
      </p>
      {controller.context.operationalState ? (
        <ProductOperationalStateNotice
          state={controller.context.operationalState}
        />
      ) : null}
      <section
        aria-label="Records 对象编辑工作台"
        className={styles.recordsGrid}
        data-testid="workbench-frame"
      >
        <MasterPane
          controller={controller}
          filtered={filtered}
          kind={kind}
          onKindChange={setKind}
          onQueryChange={setQuery}
          onRename={setRenameResource}
          query={query}
        />
        <div
          className={`${styles.mainPane} workbench-main`}
          data-testid="workbench-main"
        >
          {selectedNote ? (
            <NoteEditor
              controller={controller}
              key={selectedNote.entity.entity_id}
              note={selectedNote}
            />
          ) : (
            <EmptyPane
              description="使用页面右上角的新建笔记开始，或从左侧选择已有笔记。"
              title="选择或新建一篇笔记"
            />
          )}
        </div>
        <Inspector
          controller={controller}
          note={selectedNote}
          onAddAttachment={() => setAttachmentOpen(true)}
        />
      </section>
      <ResourceSheet
        controller={controller}
        kind={resourceKind}
        onOpenChange={setResourceKind}
      />
      <AttachmentSheet
        controller={controller}
        onOpenChange={setAttachmentOpen}
        open={attachmentOpen}
      />
      <UnlockSheet
        controller={controller}
        onOpenChange={setUnlockOpen}
        open={unlockOpen}
      />
      <RenameResourceSheet
        controller={controller}
        onOpenChange={setRenameResource}
        resource={renameResource}
      />
    </main>
  );
}
