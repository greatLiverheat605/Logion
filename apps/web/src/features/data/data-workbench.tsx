"use client";

import { useRef, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
} from "@/components/product/headless-ui";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
} from "@/components/product/workbench";
import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";

import type { DataControllerResult, DataTab } from "./use-data-controller";
import { useDataController } from "./use-data-controller";
import styles from "./data-workbench.module.css";

const DATA_FORMATS = [
  { label: "Logion JSON", value: "logion_json" },
  { label: "Markdown", value: "markdown" },
  { label: "CSV", value: "csv" },
  { label: "BibTeX", value: "bibtex" },
] as const;

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function bytesLabel(value: number | null) {
  if (value === null || value === undefined) return "生成中";
  if (value < 1024) return `${value} B`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function stateTone(state: string) {
  if (state === "succeeded" || state === "imported") return "good" as const;
  if (state === "failed" || state === "expired") return "bad" as const;
  return "warn" as const;
}

function ExportRows({
  context,
  onCancel,
  onSelect,
}: Readonly<{
  context: DataControllerResult["context"];
  onCancel: (id: string) => void;
  onSelect: (id: string) => void;
}>) {
  if (context.exports.length === 0) {
    return (
      <ProductEmptyState
        title="尚未创建导出"
        description="创建后，服务器会在后台生成加密数据包；完成后可验证校验和并下载。"
      />
    );
  }
  return (
    <ul aria-label="数据导出任务" className={styles.objectList}>
      {context.exports.map((item) => (
        <li key={item.id}>
          <button
            className={
              item.id === context.selectedExport?.id
                ? styles.selectedRow
                : undefined
            }
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className={styles.rowCopy}>
              <strong>{dateLabel(item.created_at)}</strong>
              <span>
                {item.schema_version} · {bytesLabel(item.artifact_bytes)} · 到期{" "}
                {dateLabel(item.expires_at)}
              </span>
            </span>
            <ProductTag tone={stateTone(item.status)}>{item.status}</ProductTag>
          </button>
          {item.status === "queued" || item.status === "running" ? (
            <button
              className={styles.rowAction}
              onClick={() => onCancel(item.id)}
              type="button"
            >
              取消
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ImportRows({
  context,
  onSelect,
}: Readonly<{
  context: DataControllerResult["context"];
  onSelect: (id: string) => void;
}>) {
  if (context.imports.length === 0) {
    return (
      <ProductEmptyState
        title="尚无导入预览"
        description="粘贴受支持格式的内容，先检查对象计数和警告，再确认写入自己的 Private Space。"
      />
    );
  }
  return (
    <ul aria-label="数据导入预览" className={styles.objectList}>
      {context.imports.map((item) => (
        <li key={item.id}>
          <button
            className={
              item.id === context.selectedImport?.id
                ? styles.selectedRow
                : undefined
            }
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className={styles.rowCopy}>
              <strong>{item.source_filename}</strong>
              <span>
                {item.source_format} ·{" "}
                {Object.values(item.counts).reduce(
                  (sum, count) => sum + count,
                  0,
                )}{" "}
                个对象 · 到期 {dateLabel(item.expires_at)}
              </span>
            </span>
            <ProductTag tone={stateTone(item.status)}>{item.status}</ProductTag>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ExportDetail({
  context,
  onCancel,
}: Readonly<{
  context: DataControllerResult["context"];
  onCancel: (id: string) => void;
}>) {
  const item = context.selectedExport;
  if (!item)
    return (
      <ProductEmptyState
        title="选择一个导出任务"
        description="从左侧任务列表查看生成状态、校验和与下载入口。"
      />
    );
  return (
    <section className={styles.detailSection} data-testid="data-export-detail">
      <header className={styles.detailHeader}>
        <div>
          <span className={styles.kicker}>EXPORT JOB</span>
          <h2>加密导出</h2>
          <p>
            {dateLabel(item.created_at)} 创建 · {item.schema_version}
          </p>
        </div>
        <ProductTag tone={stateTone(item.status)}>{item.status}</ProductTag>
      </header>
      <dl className={styles.detailGrid}>
        <div>
          <dt>Workspace</dt>
          <dd>{context.selectedWorkspace?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>文件大小</dt>
          <dd>{bytesLabel(item.artifact_bytes)}</dd>
        </div>
        <div>
          <dt>完成时间</dt>
          <dd>{dateLabel(item.completed_at)}</dd>
        </div>
        <div>
          <dt>有效期</dt>
          <dd>{dateLabel(item.expires_at)}</dd>
        </div>
      </dl>
      {item.artifact_sha256 ? (
        <div className={styles.hashBlock}>
          <span>SHA-256 校验和</span>
          <code>{item.artifact_sha256}</code>
        </div>
      ) : null}
      {item.error_code ? (
        <p className={styles.errorNote} role="alert">
          生成失败：{item.error_code}
        </p>
      ) : null}
      <div className={styles.detailActions}>
        {item.status === "succeeded" ? (
          <a
            className={styles.secondaryButton}
            href={`/api/v1/workspaces/${item.workspace_id}/data-exports/${item.id}/download`}
          >
            <AppIcon name="download" size={14} />
            下载加密数据包
          </a>
        ) : null}
        {item.status === "queued" || item.status === "running" ? (
          <button
            className={styles.secondaryButton}
            onClick={() => onCancel(item.id)}
            type="button"
          >
            取消导出
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ImportDetail({
  context,
  onCommit,
}: Readonly<{
  context: DataControllerResult["context"];
  onCommit: (
    item: DataControllerResult["context"]["selectedImport"],
    spaceId: string,
  ) => void;
}>) {
  const item = context.selectedImport;
  const [targetSelection, setTargetSelection] = useState(() => ({
    itemId: item?.id ?? null,
    value: item?.imported_space_id ?? "",
  }));

  if (!item)
    return (
      <ProductEmptyState
        title="选择一个导入预览"
        description="从左侧预览列表查看来源哈希、对象计数和写入边界。"
      />
    );
  const targetSpaceId =
    targetSelection.itemId === item.id
      ? targetSelection.value
      : (item.imported_space_id ?? "");
  const total = Object.values(item.counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  return (
    <section className={styles.detailSection} data-testid="data-import-detail">
      <header className={styles.detailHeader}>
        <div>
          <span className={styles.kicker}>IMPORT PREVIEW</span>
          <h2>{item.source_filename}</h2>
          <p>
            {item.source_format} · {total} 个对象 · {dateLabel(item.created_at)}{" "}
            生成
          </p>
        </div>
        <ProductTag tone={stateTone(item.status)}>{item.status}</ProductTag>
      </header>
      <dl className={styles.detailGrid}>
        {Object.entries(item.counts).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div>
          <dt>源文件 SHA-256</dt>
          <dd>
            <code>{item.source_sha256}</code>
          </dd>
        </div>
      </dl>
      {item.warnings.length ? (
        <div className={styles.warningBlock} role="note">
          <strong>导入前请处理这些提示</strong>
          <ul>
            {item.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.successNote}>
          未发现解析警告。导入会生成新对象，不会恢复原权限或原始 ID。
        </p>
      )}
      {item.status === "previewed" ? (
        <div className={styles.commitBox}>
          <label htmlFor="data-import-target">写入自己的 Private Space</label>
          <select
            id="data-import-target"
            onChange={(event) =>
              setTargetSelection({ itemId: item.id, value: event.target.value })
            }
            value={targetSpaceId}
          >
            <option value="">选择 Private Space</option>
            {context.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
          <p>
            只有 Private Space 会出现在这里；Shared Space
            和他人空间不会成为导入目标。
          </p>
          <button
            className={styles.primaryButton}
            disabled={
              !targetSpaceId ||
              !context.spaces.some((space) => space.id === targetSpaceId)
            }
            onClick={() => onCommit(item, targetSpaceId)}
            type="button"
          >
            确认写入 Private Space
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ExportSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: DataControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirmation = String(
      new FormData(event.currentTarget).get("confirmation") ?? "",
    );
    if (await controller.commands.createExport(confirmation))
      onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="导出范围绑定当前 Workspace，服务器生成加密数据包并保存 24 小时。"
      onOpenChange={onOpenChange}
      open={open}
      title="创建加密导出"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <div className={styles.scopeBlock}>
          <span>导出范围</span>
          <strong>
            {controller.context.selectedWorkspace?.name ?? "未选择 Workspace"}
          </strong>
          <small>
            包含该 Workspace 下你有权读取的对象；不包含登录凭据、恢复材料或 AI
            密钥。
          </small>
        </div>
        <label htmlFor="data-export-confirmation">输入 EXPORT 确认</label>
        <input
          autoComplete="off"
          id="data-export-confirmation"
          name="confirmation"
          pattern="EXPORT"
          required
        />
        <p className={styles.formHint}>
          下载页会再次要求近期认证，并提供 SHA-256 校验和。
        </p>
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={!controller.capabilities.canExport || controller.loading}
            type="submit"
          >
            创建加密导出
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

function ImportSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: DataControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (
      await controller.commands.previewImport({
        content: String(data.get("content") ?? ""),
        source_filename: String(data.get("source_filename") ?? "import.md"),
        source_format: String(
          data.get("source_format") ?? "markdown",
        ) as DataControllerResult["context"]["imports"][number]["source_format"],
      })
    )
      onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="解析只生成预览，不执行脚本、不访问链接，也不会在确认前写入。"
      onOpenChange={onOpenChange}
      open={open}
      title="生成导入预览"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <label htmlFor="data-import-format">格式</label>
        <select
          id="data-import-format"
          name="source_format"
          defaultValue="markdown"
        >
          {DATA_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
        <label htmlFor="data-import-filename">文件名</label>
        <input
          id="data-import-filename"
          maxLength={255}
          name="source_filename"
          defaultValue="import.md"
          required
        />
        <label htmlFor="data-import-content">内容（最多 1 MiB）</label>
        <textarea
          id="data-import-content"
          maxLength={1_048_576}
          name="content"
          required
          rows={12}
        />
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={!controller.capabilities.canImport || controller.loading}
            type="submit"
          >
            生成预览
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

function DeletionSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: DataControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirmation = String(
      new FormData(event.currentTarget).get("confirmation") ?? "",
    );
    if (await controller.commands.requestAccountDeletion(confirmation)) {
      onOpenChange(false);
      window.location.assign("/account/deletion");
    }
  }
  return (
    <WorkbenchSheet
      description="会话、分享和日历订阅立即撤销；宽限期内可在恢复页取消。"
      onOpenChange={onOpenChange}
      open={open}
      title="请求删除账户"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <div className={styles.dangerSummary}>
          <strong>影响范围</strong>
          <p>
            当前账户的个人资料、私人
            Space、导入导出记录及由你创建的对象。仍有其他成员的 Workspace
            必须先转移所有权。
          </p>
          <strong>恢复路径</strong>
          <p>
            请求后进入 <a href="/account/deletion">账户删除恢复页</a>
            ；宽限期内可取消，期限结束后不可恢复。
          </p>
        </div>
        <label htmlFor="data-delete-confirmation">
          输入 DELETE MY ACCOUNT 确认
        </label>
        <input
          autoComplete="off"
          id="data-delete-confirmation"
          name="confirmation"
          pattern="DELETE MY ACCOUNT"
          required
        />
        <p className={styles.formHint}>
          需要近期重新登录。此操作不会删除其他成员的 Workspace 数据。
        </p>
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className={styles.dangerButton}
            disabled={
              !controller.capabilities.canDeleteAccount || controller.loading
            }
            type="submit"
          >
            请求删除账户
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

function DataMaster({
  context,
  controller,
  onOpenImport,
  onSelectTab,
  tab,
}: Readonly<{
  context: DataControllerResult["context"];
  controller: DataControllerResult;
  onOpenImport: () => void;
  onSelectTab: (tab: DataTab) => void;
  tab: DataTab;
}>) {
  const hasWorkspace = context.workspaces.length > 0;
  const hasPrivateSpace = context.spaces.length > 0;
  return (
    <div data-testid="data-master" className={styles.masterPane}>
      <div className={styles.masterHeading}>
        <div>
          <span className={styles.kicker}>DATA SOVEREIGNTY</span>
          <h2>数据目录</h2>
        </div>
        <span>{context.workspaces.length}</span>
      </div>
      {!hasWorkspace ? (
        <div className={styles.masterEmpty}>
          <ProductEmptyState
            action={
              <a className={styles.stateAction} href="/app/workspaces">
                管理 Workspace
              </a>
            }
            description="当前账号没有可访问的 Workspace。请创建一个工作区，或联系管理员授予访问权限。"
            title="没有可访问 Workspace"
          />
        </div>
      ) : (
        <>
          <WorkbenchSelect
            label="当前 Workspace"
            onValueChange={controller.commands.selectWorkspace}
            options={context.workspaces.map((workspace) => ({
              label: `${workspace.name} · ${workspace.role}`,
              value: workspace.id,
            }))}
            placeholder="选择 Workspace"
            value={context.selectedWorkspace?.id}
          />
          <nav aria-label="数据目录分区" className={styles.masterNav}>
            <button
              aria-current={tab === "exports" ? "page" : undefined}
              className={tab === "exports" ? styles.selectedRow : undefined}
              onClick={() => onSelectTab("exports")}
              type="button"
            >
              <span>导出任务</span>
              <span>{context.exports.length}</span>
            </button>
            <button
              aria-current={tab === "imports" ? "page" : undefined}
              className={tab === "imports" ? styles.selectedRow : undefined}
              onClick={() => onSelectTab("imports")}
              type="button"
            >
              <span>导入预览</span>
              <span>{context.imports.length}</span>
            </button>
          </nav>
          {!hasPrivateSpace ? (
            <div className={styles.capabilityNote} role="note">
              <strong>导入能力暂不可用</strong>
              <p>
                当前 Workspace 没有你拥有的 Private Space。先创建 Private
                Space，才能确认导入写入边界。
              </p>
              <a className={styles.stateAction} href="/app/spaces">
                管理 Private Space
              </a>
            </div>
          ) : null}
          <div className={styles.masterActions}>
            <button
              className={styles.secondaryButton}
              disabled={
                !controller.capabilities.canImport || controller.loading
              }
              onClick={onOpenImport}
              type="button"
            >
              <AppIcon name="upload" size={14} />
              生成导入预览
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function DataWorkbench({
  controller,
}: Readonly<{ controller: DataControllerResult }>) {
  const [tab, setTab] = useState<DataTab>(controller.context.tab);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const context = controller.context;
  const selectTab = (next: string) => {
    const value = next as DataTab;
    setTab(value);
    controller.commands.selectTab(value);
  };
  const selectExport = (id: string) => controller.commands.selectExport(id);
  const selectImport = (id: string) => controller.commands.selectImport(id);
  const importCommit = (
    item: DataControllerResult["context"]["selectedImport"],
    spaceId: string,
  ) => {
    if (item && spaceId) void controller.commands.commitImport(item, spaceId);
  };
  const stateAction =
    context.dataState === "loading" || controller.loading ? (
      <span className={styles.stateHint}>正在读取数据边界…</span>
    ) : context.dataState === "recent-auth" ? (
      <a className={styles.stateAction} href="/auth/login?next=/app/data">
        重新登录
      </a>
    ) : context.dataState === "permission" ? (
      <button
        className={styles.stateAction}
        onClick={() => void controller.commands.load()}
        type="button"
      >
        重新读取
      </button>
    ) : context.dataState === "conflict" ||
      context.dataState === "error" ||
      context.dataState === "offline" ? (
      <button
        className={styles.stateAction}
        onClick={() => void controller.commands.load()}
        type="button"
      >
        重试读取
      </button>
    ) : null;

  return (
    <>
      <main className={`${styles.page} app-shell-content`} id="main-content">
        <WorkbenchFrame
          context={
            <WorkbenchContextBar
              context={{
                permission: {
                  label: context.selectedWorkspace?.role ?? "未选择",
                  tone: context.selectedWorkspace ? "good" : "warn",
                },
                sync: {
                  label: context.dataState === "offline" ? "离线" : "实时 API",
                  tone: context.dataState === "offline" ? "warn" : "good",
                },
                workspace: context.selectedWorkspace
                  ? {
                      id: context.selectedWorkspace.id,
                      name: context.selectedWorkspace.name,
                    }
                  : undefined,
              }}
            />
          }
          header={
            <WorkbenchHeader
              actions={
                <button
                  ref={actionRef}
                  className={styles.primaryButton}
                  data-workbench-primary="true"
                  disabled={
                    !controller.capabilities.canExport || controller.loading
                  }
                  onClick={() => setExportOpen(true)}
                  type="button"
                >
                  <AppIcon name="download" size={15} />
                  创建加密导出
                </button>
              }
              description="用可验证的导出、预览导入和隔离删除，掌握自己的数据边界。"
              eyebrow="DATA SOVEREIGNTY"
              title="数据主权"
            />
          }
          inspector={
            <div data-testid="data-inspector">
              <InspectorSection title="当前边界">
                <dl className={styles.kvList}>
                  <div>
                    <dt>Workspace</dt>
                    <dd>{context.selectedWorkspace?.name ?? "未选择"}</dd>
                  </div>
                  <div>
                    <dt>Private Space</dt>
                    <dd>{context.spaces.length} 个可用目标</dd>
                  </div>
                  <div>
                    <dt>最近读取</dt>
                    <dd>{dateLabel(context.lastLoadedAt)}</dd>
                  </div>
                </dl>
              </InspectorSection>
              <InspectorSection title="状态与恢复">
                <p aria-live="polite" className={styles.inspectorStatus}>
                  {context.status}
                </p>
                {stateAction}
                <span className={styles.inspectorNote}>
                  {context.dataState === "offline"
                    ? "网络恢复后重试；已完成的本地页面状态不会伪装成服务端成功。"
                    : "导出下载仍会要求近期认证。"}
                </span>
              </InspectorSection>
              <InspectorSection title="危险区">
                <div className={styles.dangerInspector}>
                  <strong>删除账户</strong>
                  <p>
                    撤销会话并进入可恢复宽限期。共享 Workspace 需先转移所有权。
                  </p>
                  <button
                    className={styles.dangerButton}
                    onClick={() => setDeletionOpen(true)}
                    type="button"
                  >
                    请求删除账户
                  </button>
                </div>
              </InspectorSection>
            </div>
          }
          inspectorLabel="数据主权检查器"
          label="数据主权工作台"
          main={
            <div data-testid="data-main" className={styles.mainPane}>
              <WorkbenchActionBar
                secondary={
                  <span className={styles.actionHint}>
                    {context.dataState === "empty"
                      ? "还没有导出或导入预览"
                      : context.status}
                  </span>
                }
              />
              <div
                className={styles.stateBar}
                aria-live="polite"
                data-state={context.dataState}
              >
                {stateAction}
              </div>
              <WorkbenchTabs
                label="数据主权视图"
                onValueChange={selectTab}
                tabs={[
                  {
                    label: "导出",
                    value: "exports",
                    count: context.exports.length,
                  },
                  {
                    label: "导入预览",
                    value: "imports",
                    count: context.imports.length,
                  },
                ]}
                value={tab}
              >
                <WorkbenchTabPanel value="exports">
                  <section className={styles.tabSection}>
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>EXPORTS</span>
                        <h2>导出任务</h2>
                      </div>
                      <ProductTag
                        tone={
                          context.exports.some(
                            (item) => item.status === "succeeded",
                          )
                            ? "good"
                            : "info"
                        }
                      >
                        {context.exports.length} 个任务
                      </ProductTag>
                    </header>
                    <ExportRows
                      context={context}
                      onCancel={(id) => {
                        const item = context.exports.find(
                          (entry) => entry.id === id,
                        );
                        if (item) void controller.commands.cancelExport(item);
                      }}
                      onSelect={selectExport}
                    />
                    <ExportDetail
                      context={context}
                      onCancel={(id) => {
                        const item = context.exports.find(
                          (entry) => entry.id === id,
                        );
                        if (item) void controller.commands.cancelExport(item);
                      }}
                    />
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="imports">
                  <section className={styles.tabSection}>
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>IMPORTS</span>
                        <h2>导入预览</h2>
                      </div>
                      <ProductTag
                        tone={
                          context.imports.some(
                            (item) => item.status === "previewed",
                          )
                            ? "warn"
                            : "good"
                        }
                      >
                        {context.imports.length} 个预览
                      </ProductTag>
                    </header>
                    <ImportRows context={context} onSelect={selectImport} />
                    <ImportDetail context={context} onCommit={importCommit} />
                  </section>
                </WorkbenchTabPanel>
              </WorkbenchTabs>
            </div>
          }
          mainLabel="数据视图"
          master={
            <DataMaster
              context={context}
              controller={controller}
              onOpenImport={() => setImportOpen(true)}
              onSelectTab={selectTab}
              tab={tab}
            />
          }
          masterLabel="数据目录"
          toolbar={
            <div className={styles.toolbarNote}>
              <AppIcon
                name={context.dataState === "offline" ? "lock" : "shield"}
                size={14}
              />
              <span>
                {context.dataState === "offline"
                  ? "离线：服务器导入导出动作暂不可用。"
                  : "导出、导入和删除都在当前 Workspace 边界内执行。"}
              </span>
            </div>
          }
        />
      </main>
      <ExportSheet
        controller={controller}
        onOpenChange={setExportOpen}
        open={exportOpen}
      />
      <ImportSheet
        controller={controller}
        onOpenChange={setImportOpen}
        open={importOpen}
      />
      <DeletionSheet
        controller={controller}
        onOpenChange={setDeletionOpen}
        open={deletionOpen}
      />
    </>
  );
}

export function DataRoute() {
  return <DataWorkbench controller={useDataController()} />;
}
