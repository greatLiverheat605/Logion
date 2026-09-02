"use client";

import { secureRandomUuid } from "@logion/offline";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";
import { AppIcon } from "@/components/app-shell/app-icon";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import {
  WorkbenchSelect,
  type WorkbenchSelectOption,
} from "@/components/product/headless-ui";
import {
  integrationCapabilityService,
  type IntegrationCapabilityService,
} from "@/features/integrations/integration-capability-service";

import {
  integrationCapabilityErrorState,
  summarizeIntegrationCapabilities,
  type IntegrationCapabilityData,
  type IntegrationCapabilityErrorState,
  type Workspace,
} from "./integration-capability-model";

import styles from "./integration-workbench.module.css";

type HubPhase = "empty" | "error" | "loading" | "needs-context" | "ready";
type HubService = Pick<
  IntegrationCapabilityService,
  | "listCalendarFeeds"
  | "listWorkspaces"
  | "loadPortability"
  | "cancelExport"
  | "commitImport"
  | "createCalendarFeed"
  | "createExport"
  | "previewImport"
  | "revokeCalendarFeed"
>;

const EMPTY_DATA: IntegrationCapabilityData = {
  exports: [],
  feeds: [],
  imports: [],
  privateSpaces: [],
};

function hasActivity(data: IntegrationCapabilityData): boolean {
  return Boolean(
    data.feeds.length || data.exports.length || data.imports.length,
  );
}

export function IntegrationHub({
  service = integrationCapabilityService,
}: Readonly<{ service?: HubService }>) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const [data, setData] = useState<IntegrationCapabilityData>(EMPTY_DATA);
  const [error, setError] = useState<IntegrationCapabilityErrorState | null>(
    null,
  );
  const [contextReload, setContextReload] = useState(0);
  const [dataReload, setDataReload] = useState(0);
  const [calendarToken, setCalendarToken] = useState("");
  const [targetSpaceId, setTargetSpaceId] = useState("");
  const [selectedCapability, setSelectedCapability] = useState("calendar");
  const [actionStatus, setActionStatus] =
    useState("选择工作区后可管理当前已有能力。");
  const calendarNameRef = useRef<HTMLInputElement>(null);
  const calendarTokenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void service
      .listWorkspaces()
      .then((next) => {
        if (!active) return;
        setWorkspaces(next);
        setWorkspaceId((current) =>
          next.some((workspace) => workspace.id === current)
            ? current
            : (next[0]?.id ?? ""),
        );
        setContextPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setWorkspaces([]);
        setWorkspaceId("");
        setData(EMPTY_DATA);
        setDataPhase("idle");
        setError(integrationCapabilityErrorState(reason));
        setContextPhase("error");
      });
    return () => {
      active = false;
    };
  }, [contextReload, service]);

  useEffect(() => {
    if (!workspaceId || contextPhase !== "ready") return;
    let active = true;
    void Promise.all([
      service.listCalendarFeeds(workspaceId),
      service.loadPortability(workspaceId),
    ])
      .then(([feeds, portability]) => {
        if (!active) return;
        setData({ feeds, ...portability });
        setTargetSpaceId((current) =>
          portability.privateSpaces.some((space) => space.id === current)
            ? current
            : (portability.privateSpaces[0]?.id ?? ""),
        );
        setDataPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setData(EMPTY_DATA);
        setError(integrationCapabilityErrorState(reason));
        setDataPhase("error");
      });
    return () => {
      active = false;
    };
  }, [contextPhase, dataReload, service, workspaceId]);

  useEffect(() => {
    if (calendarToken && dataPhase === "ready") {
      calendarTokenRef.current?.focus();
    }
  }, [calendarToken, dataPhase]);

  const phase: HubPhase =
    contextPhase === "loading"
      ? "loading"
      : contextPhase === "error"
        ? "error"
        : workspaces.length === 0
          ? "needs-context"
          : dataPhase === "error"
            ? "error"
            : dataPhase !== "ready"
              ? "loading"
              : hasActivity(data)
                ? "ready"
                : "empty";
  const summary = useMemo(() => summarizeIntegrationCapabilities(data), [data]);
  const currentWorkspace = workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );

  function retry() {
    setError(null);
    setData(EMPTY_DATA);
    if (contextPhase === "error") {
      setContextPhase("loading");
      setDataPhase("idle");
      setContextReload((value) => value + 1);
    } else {
      setDataPhase("loading");
      setDataReload((value) => value + 1);
    }
  }

  function selectWorkspace(nextWorkspaceId: string) {
    setData(EMPTY_DATA);
    setDataPhase("loading");
    setError(null);
    setCalendarToken("");
    setTargetSpaceId("");
    setWorkspaceId(nextWorkspaceId);
  }

  function refreshData() {
    setData(EMPTY_DATA);
    setDataPhase("loading");
    setDataReload((value) => value + 1);
  }

  function reportActionError(reason: unknown) {
    const next = integrationCapabilityErrorState(reason);
    setError(next);
    setActionStatus(
      next.kind === "recent-auth-required"
        ? "需要重新登录后才能创建数据导出。"
        : `操作未完成（${next.code}，请求编号：${next.requestId}）。`,
    );
  }

  async function createFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = event.currentTarget;
    try {
      const result = await service.createCalendarFeed(workspaceId, {
        id: secureRandomUuid(),
        name: String(new FormData(form).get("name") ?? ""),
      });
      setCalendarToken(result.token);
      form.reset();
      setError(null);
      setActionStatus("日历订阅已创建；请立即保存一次性 URL。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function revokeFeed(feedId: string, version: number) {
    if (!workspaceId) return;
    try {
      await service.revokeCalendarFeed(workspaceId, feedId, version);
      setError(null);
      setActionStatus("日历订阅已撤销，旧 URL 已立即失效。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function createExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = event.currentTarget;
    const confirmation = String(new FormData(form).get("confirmation") ?? "");
    try {
      await service.createExport(workspaceId, {
        confirmation,
        id: secureRandomUuid(),
      });
      form.reset();
      setError(null);
      setActionStatus("导出任务已进入后台队列。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function cancelExport(exportId: string, version: number) {
    if (!workspaceId) return;
    try {
      await service.cancelExport(workspaceId, exportId, version);
      setError(null);
      setActionStatus("导出任务已取消。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await service.previewImport(workspaceId, {
        content: String(form.get("content") ?? ""),
        id: secureRandomUuid(),
        source_filename: String(form.get("source_filename") ?? "import.md"),
        source_format: String(
          form.get("source_format") ?? "markdown",
        ) as IntegrationCapabilityData["imports"][number]["source_format"],
      });
      formElement.reset();
      setError(null);
      setActionStatus("导入内容已安全解析；确认计数和警告后再提交。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function commitImport(importId: string, version: number) {
    if (!workspaceId || !targetSpaceId) return;
    try {
      await service.commitImport(workspaceId, importId, {
        expected_version: version,
        target_space_id: targetSpaceId,
      });
      setError(null);
      setActionStatus("导入已提交到自己的 Private Space，并使用新的对象 ID。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function copyCalendarUrl() {
    if (!calendarToken) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/api/v1/calendars/${calendarToken}.ics`,
      );
      setActionStatus("一次性 Calendar URL 已复制到剪贴板。");
    } catch {
      setActionStatus("复制失败；请手动选择并保存一次性 URL。");
    }
  }

  function closeCalendarUrl() {
    setCalendarToken("");
    setActionStatus("一次性 URL 已从页面关闭；未保存时请撤销并重新创建。");
    queueMicrotask(() => calendarNameRef.current?.focus());
  }

  const workspaceOptions: WorkbenchSelectOption[] = workspaces.map(
    (workspace) => ({
      label: `${workspace.name} · ${workspace.role}`,
      value: workspace.id,
    }),
  );

  return (
    <main className={styles.root} id="main-content">
      <WorkbenchFrame
        label="互操作能力工作台"
        header={
          <WorkbenchHeader
            eyebrow="SYSTEM · INTEROPERABILITY"
            title={
              <>
                <span>互操作中心</span>
                <small className={styles.titleDescriptor}>
                  把已有数据能力连接起来
                </small>
              </>
            }
            description="不扩大权限边界地连接已有数据能力。所有状态来自当前 Workspace 的真实 API。"
            actions={
              phase === "error" ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={retry}
                >
                  <AppIcon name="refresh" size={14} />
                  重新读取
                </button>
              ) : undefined
            }
          />
        }
        context={
          <WorkbenchContextBar
            context={{
              workspace: currentWorkspace
                ? { id: currentWorkspace.id, name: currentWorkspace.name }
                : undefined,
              permission: currentWorkspace
                ? {
                    label: currentWorkspace.role,
                    tone:
                      currentWorkspace.role === "owner" ||
                      currentWorkspace.role === "admin"
                        ? "good"
                        : "warn",
                  }
                : undefined,
              sync: { label: "实时 API", tone: "good" },
              vault: { label: "服务端上下文" },
            }}
          />
        }
        toolbar={
          <WorkbenchToolbar label="互操作工具">
            <div className={styles.toolbarLead} aria-live="polite">
              {error
                ? error.kind === "recent-auth-required"
                  ? "此操作需要重新登录后继续。"
                  : `读取未完成（${error.code}）。`
                : actionStatus}
            </div>
            <WorkbenchSelect
              label="数据工作区"
              onValueChange={selectWorkspace}
              options={workspaceOptions}
              placeholder="选择工作区"
              value={workspaceId}
            />
          </WorkbenchToolbar>
        }
        masterLabel="能力目录"
        master={
          <aside className={styles.masterPane}>
            <div className={styles.paneHeading}>
              <span className={styles.eyebrow}>CAPABILITIES</span>
              <strong>能力目录</strong>
            </div>
            <nav className={styles.capabilityList} aria-label="互操作能力">
              <button
                className={
                  selectedCapability === "calendar"
                    ? styles.capabilityActive
                    : undefined
                }
                type="button"
                onClick={() => setSelectedCapability("calendar")}
              >
                <AppIcon name="calendar" size={15} />
                <span>
                  <strong>Calendar Feed</strong>
                  <small>{summary.calendar.active} 个有效订阅</small>
                </span>
                <ProductTag tone="good">可用</ProductTag>
              </button>
              <button
                className={
                  selectedCapability === "import"
                    ? styles.capabilityActive
                    : undefined
                }
                type="button"
                onClick={() => setSelectedCapability("import")}
              >
                <AppIcon name="upload" size={15} />
                <span>
                  <strong>导入预览</strong>
                  <small>{summary.imports.previewed} 个待确认</small>
                </span>
                <ProductTag tone="good">可用</ProductTag>
              </button>
              <button
                className={
                  selectedCapability === "export"
                    ? styles.capabilityActive
                    : undefined
                }
                type="button"
                onClick={() => setSelectedCapability("export")}
              >
                <AppIcon name="download" size={15} />
                <span>
                  <strong>导出任务</strong>
                  <small>{summary.exports.total} 条记录</small>
                </span>
                <ProductTag tone="good">可用</ProductTag>
              </button>
              <button
                className={
                  selectedCapability === "unsupported"
                    ? styles.capabilityActive
                    : undefined
                }
                type="button"
                onClick={() => setSelectedCapability("unsupported")}
              >
                <AppIcon name="lock" size={15} />
                <span>
                  <strong>第三方连接器</strong>
                  <small>OAuth / Webhook / Token</small>
                </span>
                <ProductTag tone="warn">未开放</ProductTag>
              </button>
            </nav>
            <div className={styles.masterNote}>
              第三方账号连接、Webhook、MCP / API Token 和自动化规则保持
              capability-disabled；入口保留，替代路径是开放格式导入导出。
            </div>
          </aside>
        }
        mainLabel="能力详情"
        main={
          <div className={styles.mainPane}>
            <WorkbenchActionBar
              secondary={
                <button
                  type="button"
                  onClick={refreshData}
                  disabled={!workspaceId}
                >
                  <AppIcon name="refresh" size={14} />
                  刷新能力
                </button>
              }
              primary={
                selectedCapability === "calendar" ? (
                  <button
                    className={styles.primaryButton}
                    type="submit"
                    form="calendar-feed-form"
                    disabled={!workspaceId || dataPhase !== "ready"}
                  >
                    <AppIcon name="plus" size={14} />
                    创建日历订阅
                  </button>
                ) : selectedCapability === "import" ? (
                  <button
                    className={styles.primaryButton}
                    type="submit"
                    form="integration-import-form"
                    disabled={!workspaceId || dataPhase !== "ready"}
                  >
                    <AppIcon name="upload" size={14} />
                    生成导入预览
                  </button>
                ) : selectedCapability === "export" ? (
                  <button
                    className={styles.primaryButton}
                    type="submit"
                    form="integration-export-form"
                    disabled={!workspaceId || dataPhase !== "ready"}
                  >
                    <AppIcon name="download" size={14} />
                    创建加密导出
                  </button>
                ) : undefined
              }
            />
            {dataPhase === "ready" ? (
              <section
                className={styles.dataSection}
                data-testid="integrations-summary"
              >
                <header className={styles.sectionHeader}>
                  <div>
                    <span className={styles.eyebrow}>
                      INTEROPERABILITY OVERVIEW
                    </span>
                    <h2>能力总览</h2>
                  </div>
                  <ProductTag tone="good">真实 API 状态</ProductTag>
                </header>
                <div className={styles.metricStrip}>
                  <div>
                    <span>有效日历 Feed</span>
                    <strong>{summary.calendar.active}</strong>
                    <small>{summary.calendar.revoked} 个已撤销</small>
                  </div>
                  <div>
                    <span>待确认导入</span>
                    <strong>{summary.imports.previewed}</strong>
                    <small>{summary.imports.imported} 个已提交</small>
                  </div>
                  <div>
                    <span>成功导出</span>
                    <strong>{summary.exports.succeeded}</strong>
                    <small>{summary.exports.total} 个全部任务</small>
                  </div>
                  <div>
                    <span>自己的 Private Space</span>
                    <strong>{summary.privateSpaces}</strong>
                    <small>仅可作为导入目标</small>
                  </div>
                </div>
              </section>
            ) : null}
            {phase === "loading" ? (
              <ProductEmptyState
                description="正在读取可访问工作区、日历订阅与数据迁移任务。"
                icon="⌁"
                title="正在准备互操作状态"
              />
            ) : null}
            {phase === "needs-context" ? (
              <ProductEmptyState
                description="获得工作区访问权限后即可读取真实的迁移与日历状态。"
                icon="□"
                title="尚无可访问工作区"
              />
            ) : null}
            {phase === "error" ? (
              <ProductEmptyState
                action={
                  <button type="button" onClick={retry}>
                    重新读取
                  </button>
                }
                description="读取失败不会被显示成空数据；可使用请求编号排查。"
                icon="?"
                title="互操作状态暂时不可用"
              />
            ) : null}
            {phase === "empty" ? (
              <ProductEmptyState
                description="可以从下方入口创建日历订阅、导入预览或导出任务。"
                icon="+"
                title="当前工作区尚无互操作记录"
              />
            ) : null}
            {dataPhase === "ready" ? (
              <>
                <section
                  className={styles.dataSection}
                  data-testid="integrations-calendar"
                >
                  <header className={styles.sectionHeader}>
                    <div>
                      <span className={styles.eyebrow}>CALENDAR FEED</span>
                      <h2>Calendar Feed</h2>
                    </div>
                    <ProductTag tone="good">只读 ICS</ProductTag>
                  </header>
                  <p className={styles.muted}>
                    Feed 只包含必要标题与时间；撤销后旧 URL 立即失效。新 Token
                    只在创建响应中显示一次。
                  </p>
                  <form
                    id="calendar-feed-form"
                    className={styles.inlineForm}
                    onSubmit={createFeed}
                  >
                    <label>
                      订阅名称
                      <input
                        name="name"
                        maxLength={120}
                        ref={calendarNameRef}
                        required
                      />
                    </label>
                  </form>
                  {calendarToken ? (
                    <div
                      className={styles.integrationToken}
                      data-testid="calendar-token-notice"
                      ref={calendarTokenRef}
                      role="status"
                      tabIndex={-1}
                    >
                      <strong>一次性 URL</strong>
                      <a
                        href={`/api/v1/calendars/${calendarToken}.ics`}
                        rel="noreferrer"
                      >
                        /api/v1/calendars/{calendarToken}.ics
                      </a>
                      <div className={styles.inlineActions}>
                        <button type="button" onClick={copyCalendarUrl}>
                          复制一次性 URL
                        </button>
                        <button type="button" onClick={closeCalendarUrl}>
                          关闭一次性 URL
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <ul className={styles.dataList}>
                    {data.feeds.map((feed) => (
                      <li key={feed.id}>
                        <span>
                          <strong>{feed.name}</strong>
                          <small>{feed.status}</small>
                        </span>
                        {feed.status === "active" ? (
                          <button
                            type="button"
                            onClick={() =>
                              void revokeFeed(feed.id, feed.version)
                            }
                          >
                            撤销
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
                <section
                  className={styles.dataSection}
                  data-testid="integrations-open-format"
                >
                  <header className={styles.sectionHeader}>
                    <div>
                      <span className={styles.eyebrow}>OPEN FORMAT IMPORT</span>
                      <h2>开放格式导入</h2>
                    </div>
                    <ProductTag tone="warn">先预览</ProductTag>
                  </header>
                  <p className={styles.muted}>
                    支持 Logion JSON、Markdown、CSV 与 BibTeX；只允许写入自己的
                    Private Space。
                  </p>
                  <form
                    id="integration-import-form"
                    className={styles.formStack}
                    onSubmit={previewImport}
                  >
                    <div className={styles.formGrid}>
                      <label>
                        格式
                        <select name="source_format" defaultValue="markdown">
                          <option value="logion_json">Logion JSON</option>
                          <option value="markdown">Markdown</option>
                          <option value="csv">CSV</option>
                          <option value="bibtex">BibTeX</option>
                        </select>
                      </label>
                      <label>
                        文件名
                        <input
                          name="source_filename"
                          defaultValue="import.md"
                          maxLength={255}
                          required
                        />
                      </label>
                    </div>
                    <label>
                      内容（最大 1 MiB）
                      <textarea name="content" maxLength={1_048_576} required />
                    </label>
                  </form>
                  <label
                    className={styles.targetLabel}
                    htmlFor="integration-target-space"
                  >
                    写入自己的 Private Space
                    <select
                      id="integration-target-space"
                      value={targetSpaceId}
                      onChange={(event) => setTargetSpaceId(event.target.value)}
                    >
                      {data.privateSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ul className={styles.dataList}>
                    {data.imports.map((item) => (
                      <li key={item.id}>
                        <span>
                          <strong>
                            {item.source_filename} · {item.status}
                          </strong>
                          <small>
                            {JSON.stringify(item.counts)}
                            {item.warnings.length
                              ? ` · ${item.warnings.join(" · ")}`
                              : ""}
                          </small>
                        </span>
                        {item.status === "previewed" ? (
                          <button
                            type="button"
                            disabled={!targetSpaceId}
                            onClick={() =>
                              void commitImport(item.id, item.version)
                            }
                          >
                            确认 IMPORT
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
                <section
                  className={styles.dataSection}
                  data-testid="integrations-export"
                >
                  <header className={styles.sectionHeader}>
                    <div>
                      <span className={styles.eyebrow}>DATA EXPORT</span>
                      <h2>数据导出</h2>
                    </div>
                    <ProductTag tone="good">可校验</ProductTag>
                  </header>
                  <p className={styles.muted}>
                    导出需要近期认证，并提供短期下载与 SHA-256。
                  </p>
                  <form
                    id="integration-export-form"
                    className={styles.inlineForm}
                    onSubmit={createExport}
                  >
                    <label>
                      输入 EXPORT 确认创建
                      <input name="confirmation" pattern="EXPORT" required />
                    </label>
                  </form>
                  <ul className={styles.dataList}>
                    {data.exports.map((item) => (
                      <li key={item.id}>
                        <span>
                          <strong>{item.status}</strong>
                          <small>
                            {item.artifact_bytes ?? 0} bytes · 到期时间{" "}
                            {item.expires_at}
                            {item.artifact_sha256
                              ? ` · ${item.artifact_sha256}`
                              : ""}
                          </small>
                        </span>
                        {item.status === "succeeded" ? (
                          <a
                            href={`/api/v1/workspaces/${workspaceId}/data-exports/${item.id}/download`}
                          >
                            下载
                          </a>
                        ) : item.status === "queued" ||
                          item.status === "running" ? (
                          <button
                            type="button"
                            onClick={() =>
                              void cancelExport(item.id, item.version)
                            }
                          >
                            取消
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : null}
            <section
              className={styles.unsupportedSection}
              data-testid="integrations-deferred"
            >
              <h2>通用连接器与自动化</h2>
              <p>
                以下能力需要独立的凭据存储、授权、审计与后台调度设计；本页不会伪造连接状态。
              </p>
              <div className={styles.unsupportedList}>
                <article>
                  <h3>第三方账号连接</h3>
                  <p>Zotero 账号同步与 OAuth 尚未开放。</p>
                </article>
                <article>
                  <h3>Webhook</h3>
                  <p>入站与出站投递尚未开放。</p>
                </article>
                <article>
                  <h3>MCP / API Token</h3>
                  <p>创建、轮换、撤销与能力授权尚未开放。</p>
                </article>
                <article>
                  <h3>自动化规则</h3>
                  <p>触发器、执行器、重试与运行历史尚未开放。</p>
                </article>
              </div>
            </section>
          </div>
        }
        inspectorLabel="互操作检查器"
        inspector={
          <div className={styles.inspectorPane}>
            <InspectorSection title="当前 Workspace">
              <dl className={styles.kvList}>
                <div>
                  <dt>名称</dt>
                  <dd>{currentWorkspace?.name ?? "未选择"}</dd>
                </div>
                <div>
                  <dt>角色</dt>
                  <dd>{currentWorkspace?.role ?? "-"}</dd>
                </div>
                <div>
                  <dt>Private Space</dt>
                  <dd>{summary.privateSpaces} 个</dd>
                </div>
                <div>
                  <dt>同步</dt>
                  <dd>实时 API</dd>
                </div>
              </dl>
            </InspectorSection>
            <InspectorSection title="Capability 边界">
              <p className={styles.muted}>
                Calendar Feed、开放格式导入导出可用；第三方账号、Webhook、MCP /
                API Token 和自动化规则尚未开放。
              </p>
              <p className={styles.capabilityHint}>
                替代路径：使用 Markdown / CSV / BibTeX 导入，或创建加密导出。
              </p>
            </InspectorSection>
            <InspectorSection title="操作状态">
              <p className={styles.muted} aria-live="polite">
                {error
                  ? `请求编号：${error.requestId}`
                  : "状态已在工具栏实时回显。"}
              </p>
              {error?.kind === "recent-auth-required" ? (
                <p className={styles.stateWarn}>
                  需要重新登录后才能创建数据导出。
                </p>
              ) : null}
            </InspectorSection>
          </div>
        }
      />
    </main>
  );
}
