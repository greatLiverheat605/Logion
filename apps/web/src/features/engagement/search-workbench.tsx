"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import { ProductOperationalStateNotice } from "@/components/product/product-workbench-state";
import { ProductTag } from "@/components/product/product-ui";
import { WorkbenchHeader } from "@/components/product/workbench";
import { NOTIFICATION_CATEGORIES } from "@/features/engagement/notification-center-model";
import type { CalendarFeed } from "@/features/integrations/integration-capability-model";

import styles from "./search-workbench.module.css";
import {
  searchResultRoute,
  type SearchControllerResult,
  type SearchDisplayResult,
  type SearchMode,
  type SearchNotification,
  type SearchObjectType,
  type SearchPreference,
  type SearchScope,
} from "./use-search-controller";

type SearchTab = "calendar" | "notifications" | "search";

const TYPE_META: Readonly<
  Record<SearchObjectType, { icon: AppIconName; label: string }>
> = {
  goal: { icon: "target", label: "目标" },
  note: { icon: "files", label: "笔记" },
  paper: { icon: "book-open", label: "论文" },
  resource: { icon: "folder", label: "资料" },
  task: { icon: "clipboard", label: "任务" },
};

const MODE_OPTIONS: ReadonlyArray<{ label: string; value: SearchMode }> = [
  { label: "全部", value: "all" },
  { label: "目标", value: "goal" },
  { label: "任务", value: "task" },
  { label: "笔记", value: "note" },
  { label: "资料", value: "resource" },
  { label: "论文", value: "paper" },
];

const SCOPE_OPTIONS: ReadonlyArray<{ label: string; value: SearchScope }> = [
  { label: "全部范围", value: "all" },
  { label: "私有", value: "private" },
  { label: "共享", value: "shared" },
];

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  ai: "AI",
  collaboration: "协作",
  learning: "学习",
  security: "安全",
  sync: "同步",
  system: "系统",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function minuteToTime(value: number | null): string {
  if (value === null) return "";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60,
  ).padStart(2, "0")}`;
}

function timeToMinute(value: FormDataEntryValue | null): number | null {
  const time = String(value ?? "");
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (
    hours === undefined ||
    minutes === undefined ||
    hours > 23 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

function spaceName(
  controller: SearchControllerResult,
  result: SearchDisplayResult,
): string {
  if (!result.space_id) return "本机缓存";
  return (
    controller.utilities.spaces.find((space) => space.id === result.space_id)
      ?.name ?? `Space ${result.space_id.slice(0, 8)}`
  );
}

function SearchEmpty({
  action,
  description,
  title,
}: Readonly<{ action?: ReactNode; description: string; title: string }>) {
  return (
    <section className={styles.emptyState}>
      <span aria-hidden="true">
        <AppIcon name="search" size={19} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {action}
      </div>
    </section>
  );
}

function ResultPreview({
  controller,
  result,
}: Readonly<{
  controller: SearchControllerResult;
  result: SearchDisplayResult | null;
}>) {
  if (!result) {
    return (
      <div className={styles.previewEmpty}>
        <AppIcon name="book-open" size={19} />
        <p>选择一条结果查看来源、权限与可执行入口。</p>
      </div>
    );
  }
  const meta = TYPE_META[result.object_type];
  return (
    <div className={styles.previewContent}>
      <header>
        <span aria-hidden="true">
          <AppIcon name={meta.icon} size={18} />
        </span>
        <div>
          <p className={styles.eyebrow}>RESULT PREVIEW</p>
          <h2>{result.title}</h2>
        </div>
      </header>
      <dl className={styles.previewDetails}>
        <div>
          <dt>类型</dt>
          <dd>{meta.label}</dd>
        </div>
        <div>
          <dt>Space</dt>
          <dd>{spaceName(controller, result)}</dd>
        </div>
        <div>
          <dt>权限来源</dt>
          <dd>{result.permission_source}</dd>
        </div>
        <div>
          <dt>更新</dt>
          <dd>{formatDate(result.updated_at)}</dd>
        </div>
      </dl>
      <section className={styles.previewSnippet}>
        <h3>匹配片段</h3>
        <p>{result.snippet || "该对象没有可显示的摘要。"}</p>
      </section>
      <Link
        className={styles.secondaryButton}
        href={searchResultRoute(result.object_type)}
      >
        打开所在页面
        <AppIcon className={styles.arrowIcon} name="chevron-down" size={15} />
      </Link>
    </div>
  );
}

function SearchCommand({
  controller,
  mode,
  noResults,
  onModeChange,
  onQueryChange,
  onScopeChange,
  query,
  scope,
}: Readonly<{
  controller: SearchControllerResult;
  mode: SearchMode;
  noResults: boolean;
  onModeChange: (mode: SearchMode) => void;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: SearchScope) => void;
  query: string;
  scope: SearchScope;
}>) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const offlineLocked =
    !controller.context.online && !controller.context.offlineUnlocked;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await controller.commands.search({ mode, query });
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passphrase) return;
    setUnlocking(true);
    const unlocked = await controller.commands.unlock(passphrase);
    setUnlocking(false);
    if (unlocked) setPassphrase("");
  }

  return (
    <div className={styles.commandPane}>
      <form
        className={styles.commandForm}
        data-testid="search-command"
        data-workbench-primary={
          !noResults && !offlineLocked ? "true" : undefined
        }
        onSubmit={submit}
        role="search"
      >
        <AppIcon name="search" size={17} />
        <label className="sr-only" htmlFor="unified-search-input">
          统一搜索
        </label>
        <input
          autoFocus
          disabled={!controller.capabilities.canSearch || offlineLocked}
          id="unified-search-input"
          maxLength={100}
          minLength={2}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索目标、任务、笔记、资料、论文…"
          required
          type="search"
          value={query}
        />
        {query ? (
          <WorkbenchTooltip content="清除当前查询">
            <button
              aria-label="清除当前查询"
              className={styles.iconButton}
              onClick={() => {
                onQueryChange("");
                controller.commands.resetSearch();
              }}
              type="button"
            >
              <AppIcon name="close" size={15} />
            </button>
          </WorkbenchTooltip>
        ) : null}
      </form>
      <div
        aria-label="搜索类型"
        className={styles.modeSegmented}
        data-testid="search-modes"
        role="group"
      >
        {MODE_OPTIONS.map((option) => (
          <button
            aria-pressed={mode === option.value}
            key={option.value}
            onClick={() => onModeChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className={styles.scopeRow}>
        <div
          aria-label="权限范围"
          className={styles.scopeSegmented}
          role="group"
        >
          {SCOPE_OPTIONS.map((option) => (
            <button
              aria-pressed={scope === option.value}
              disabled={!controller.context.online && option.value !== "all"}
              key={option.value}
              onClick={() => onScopeChange(option.value)}
              title={
                !controller.context.online && option.value !== "all"
                  ? "离线索引不保留服务器权限来源，范围固定为全部缓存"
                  : undefined
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <span>{controller.context.online ? "服务器范围" : "本机缓存"}</span>
      </div>
      <div className={styles.workspaceContext}>
        <div>
          <span>Workspace</span>
          <strong>
            {controller.context.operational.workspace?.name ?? "正在读取"}
          </strong>
        </div>
        <WorkbenchSelect
          disabled={controller.context.workspaces.length < 2}
          label="切换搜索 Workspace"
          onValueChange={controller.commands.setWorkspaceId}
          options={controller.context.workspaces.map((workspace) => ({
            label: `${workspace.name} · ${workspace.role}`,
            value: workspace.id,
          }))}
          value={controller.context.workspaceId || undefined}
        />
      </div>
      {!controller.context.online ? (
        <p className={styles.offlineNote}>
          离线时只搜索本机已同步、未删除且已解锁的缓存；查询不会离开设备。
        </p>
      ) : null}
      {offlineLocked ? (
        <form
          className={styles.unlockForm}
          data-workbench-primary="true"
          id="search-vault"
          onSubmit={unlock}
        >
          <AppIcon name="lock" size={17} />
          <label htmlFor="search-vault-passphrase">本机缓存口令</label>
          <input
            autoComplete="current-password"
            id="search-vault-passphrase"
            onChange={(event) => setPassphrase(event.target.value)}
            required
            type="password"
            value={passphrase}
          />
          <button disabled={!passphrase || unlocking} type="submit">
            {unlocking ? "正在解锁" : "解锁缓存"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function SearchResults({
  controller,
  noResults,
  onClear,
  onOpenResult,
}: Readonly<{
  controller: SearchControllerResult;
  noResults: boolean;
  onClear: () => void;
  onOpenResult: (resultId: string, trigger: HTMLButtonElement) => void;
}>) {
  function moveFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    resultId: string,
  ) {
    if (!["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const rows = Array.from(
      event.currentTarget
        .closest('[data-testid="search-results"]')
        ?.querySelectorAll<HTMLButtonElement>("[data-search-result]") ?? [],
    );
    const current = rows.findIndex(
      (row) => row.dataset.searchResult === resultId,
    );
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
            rows.length;
    rows[target]?.focus();
    if (rows[target]?.dataset.searchResult) {
      controller.commands.selectResult(rows[target].dataset.searchResult);
    }
  }

  return (
    <div className={styles.resultsPane} data-testid="search-results">
      {controller.context.operationalState ? (
        <ProductOperationalStateNotice
          state={controller.context.operationalState}
        />
      ) : null}
      <p aria-live="polite" className={styles.statusLine} role="status">
        {controller.context.status}
      </p>
      {controller.search.phase === "idle" ? (
        <SearchEmpty
          description="统一入口覆盖目标、任务、笔记、资料与论文；结果按类型分组，选择后可预览并打开正式页面。"
          title="输入关键词开始搜索"
        />
      ) : null}
      {noResults ? (
        <SearchEmpty
          action={
            <div data-workbench-primary="true">
              <button
                className={styles.primaryButton}
                onClick={onClear}
                type="button"
              >
                清除筛选
              </button>
            </div>
          }
          description="尝试更短的关键词，或恢复全部类型与权限范围。搜索始终先执行成员资格与 Space 可见性过滤。"
          title={`没有匹配“${controller.search.lastQuery}”的结果`}
        />
      ) : null}
      {controller.search.groups.length ? (
        <div className={styles.resultGroups}>
          {controller.search.groups.map((group) => {
            const meta = TYPE_META[group.type];
            return (
              <section key={group.type}>
                <header className={styles.groupHeader}>
                  <div>
                    <AppIcon name={meta.icon} size={15} />
                    <h2>{meta.label}</h2>
                  </div>
                  <span>{group.items.length}</span>
                </header>
                <div
                  aria-label={`${meta.label}搜索结果`}
                  className={styles.resultList}
                >
                  {group.items.map((result) => {
                    const selected =
                      controller.search.selectedResult?.object_id ===
                      result.object_id;
                    return (
                      <button
                        aria-current={selected ? "true" : undefined}
                        className={styles.resultRow}
                        data-search-result={result.object_id}
                        data-selected={selected}
                        key={`${result.object_type}:${result.object_id}`}
                        onClick={(event) =>
                          onOpenResult(result.object_id, event.currentTarget)
                        }
                        onFocus={() =>
                          controller.commands.selectResult(result.object_id)
                        }
                        onKeyDown={(event) =>
                          moveFocus(event, result.object_id)
                        }
                        type="button"
                      >
                        <span className={styles.resultIcon}>
                          <AppIcon name={meta.icon} size={16} />
                        </span>
                        <span className={styles.resultCopy}>
                          <strong>{result.title}</strong>
                          <span>
                            {result.snippet || "没有可显示的匹配片段。"}
                          </span>
                          <small>
                            {spaceName(controller, result)} ·{" "}
                            {formatDate(result.updated_at)}
                          </small>
                        </span>
                        <ProductTag
                          tone={
                            result.permission_source === "shared_space"
                              ? "info"
                              : "default"
                          }
                        >
                          {result.permission_source === "shared_space"
                            ? "共享"
                            : result.permission_source === "offline_cache"
                              ? "缓存"
                              : "私有"}
                        </ProductTag>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SearchPanel({
  controller,
  onScopeChange,
  scope,
}: Readonly<{
  controller: SearchControllerResult;
  onScopeChange: (scope: SearchScope) => void;
  scope: SearchScope;
}>) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const noResults =
    controller.search.searched &&
    controller.search.phase === "ready" &&
    controller.search.resultCount === 0;

  useEffect(() => {
    if (!controller.context.online && scope !== "all") onScopeChange("all");
  }, [controller.context.online, onScopeChange, scope]);

  function clearSearch() {
    setQuery("");
    setMode("all");
    onScopeChange("all");
    controller.commands.resetSearch();
  }

  function changeMode(nextMode: SearchMode) {
    setMode(nextMode);
    if (query.trim().length >= 2) {
      void controller.commands.search({ mode: nextMode, query });
    }
  }

  function openResult(resultId: string, trigger: HTMLButtonElement) {
    controller.commands.selectResult(resultId);
    if (window.matchMedia("(max-width: 719px)").matches) {
      previewTriggerRef.current = trigger;
      setPreviewOpen(true);
    }
  }

  return (
    <div className={styles.searchLayout}>
      <aside
        aria-label="搜索与筛选"
        className={`${styles.masterPane} workbench-master`}
        data-testid="workbench-master"
      >
        <SearchCommand
          controller={controller}
          mode={mode}
          noResults={noResults}
          onModeChange={changeMode}
          onQueryChange={setQuery}
          onScopeChange={onScopeChange}
          query={query}
          scope={scope}
        />
      </aside>
      <section
        aria-label="分组搜索结果"
        className={`${styles.mainPane} workbench-main`}
        data-testid="workbench-main"
      >
        <SearchResults
          controller={controller}
          noResults={noResults}
          onClear={clearSearch}
          onOpenResult={openResult}
        />
      </section>
      <aside
        aria-label="搜索结果预览"
        className={`${styles.inspectorPane} workbench-inspector`}
        data-testid="workbench-inspector"
      >
        <div data-testid="search-preview">
          <ResultPreview
            controller={controller}
            result={controller.search.selectedResult}
          />
        </div>
      </aside>
      <WorkbenchSheet
        description="预览来自当前 Workspace 的权限过滤结果。"
        onOpenChange={setPreviewOpen}
        open={previewOpen}
        restoreFocusRef={previewTriggerRef}
        title="搜索结果预览"
      >
        <ResultPreview
          controller={controller}
          result={controller.search.selectedResult}
        />
      </WorkbenchSheet>
    </div>
  );
}

function NotificationPreferences({
  controller,
  preference,
}: Readonly<{
  controller: SearchControllerResult;
  preference: SearchPreference | null;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const quietStartMinute = timeToMinute(data.get("quiet_start"));
    const quietEndMinute = timeToMinute(data.get("quiet_end"));
    setPending(true);
    await controller.commands.savePreferences({
      enabledCategories: data.getAll("categories").map(String) as Parameters<
        typeof controller.commands.savePreferences
      >[0]["enabledCategories"],
      quietEndMinute:
        quietStartMinute === null || quietEndMinute === null
          ? null
          : quietEndMinute,
      quietStartMinute:
        quietStartMinute === null || quietEndMinute === null
          ? null
          : quietStartMinute,
      timezone: String(data.get("timezone") ?? "UTC"),
    });
    setPending(false);
  }

  return (
    <form
      className={styles.preferenceForm}
      id={formId}
      key={preference?.version ?? 0}
      onSubmit={submit}
    >
      <header className={styles.utilityHeader}>
        <div>
          <p className={styles.eyebrow}>DELIVERY RULES</p>
          <h2>通知偏好</h2>
        </div>
        <div data-workbench-primary="true">
          <button
            className={styles.primaryButton}
            disabled={!controller.capabilities.canManageUtilities || pending}
            type="submit"
          >
            {pending ? "正在保存" : "保存偏好"}
          </button>
        </div>
      </header>
      <fieldset className={styles.settingList}>
        <legend className="sr-only">通知类别</legend>
        {NOTIFICATION_CATEGORIES.map((category) => {
          const security = category === "security";
          return (
            <label className={styles.settingRow} key={category}>
              <span>
                <strong>{CATEGORY_LABEL[category] ?? category}</strong>
                <small>
                  {security
                    ? "安全事件必须可达，不能关闭。"
                    : "在通知中心显示该类需要处理的提醒。"}
                </small>
              </span>
              <input
                defaultChecked={
                  security ||
                  (preference?.enabled_categories.includes(category) ?? true)
                }
                disabled={security}
                name="categories"
                type="checkbox"
                value={category}
              />
            </label>
          );
        })}
      </fieldset>
      <div className={styles.preferenceFields}>
        <label>
          时区
          <input
            defaultValue={preference?.timezone ?? "UTC"}
            maxLength={64}
            name="timezone"
            required
          />
        </label>
        <label>
          静默开始
          <input
            defaultValue={minuteToTime(preference?.quiet_start_minute ?? null)}
            name="quiet_start"
            type="time"
          />
        </label>
        <label>
          静默结束
          <input
            defaultValue={minuteToTime(preference?.quiet_end_minute ?? null)}
            name="quiet_end"
            type="time"
          />
        </label>
      </div>
    </form>
  );
}

function NotificationRow({
  controller,
  notification,
}: Readonly<{
  controller: SearchControllerResult;
  notification: SearchNotification;
}>) {
  const [pending, setPending] = useState(false);
  return (
    <article className={styles.notificationRow}>
      <span aria-hidden="true">
        <AppIcon name="bell" size={16} />
      </span>
      <div>
        <header>
          <strong>{notification.title}</strong>
          {notification.read_at ? null : (
            <ProductTag tone="info">未读</ProductTag>
          )}
        </header>
        <p>{notification.summary}</p>
        <small>
          {CATEGORY_LABEL[notification.category] ?? notification.category} ·{" "}
          {formatDate(notification.created_at)}
        </small>
      </div>
      {notification.read_at ? (
        <ProductTag tone="good">已读</ProductTag>
      ) : (
        <button
          className={styles.textButton}
          disabled={!controller.capabilities.canManageUtilities || pending}
          onClick={async () => {
            setPending(true);
            await controller.commands.markRead(notification);
            setPending(false);
          }}
          type="button"
        >
          {pending ? "正在更新" : "标为已读"}
        </button>
      )}
    </article>
  );
}

function NotificationsPanel({
  controller,
}: {
  controller: SearchControllerResult;
}) {
  return (
    <div className={styles.utilityPanel}>
      <p aria-live="polite" className={styles.statusLine} role="status">
        {controller.context.status}
      </p>
      <NotificationPreferences
        controller={controller}
        preference={controller.utilities.preference}
      />
      <section className={styles.notificationSection}>
        <header className={styles.utilityHeader}>
          <div>
            <p className={styles.eyebrow}>INBOX</p>
            <h2>通知记录</h2>
          </div>
          <ProductTag
            tone={
              controller.utilities.unreadNotificationCount ? "warn" : "good"
            }
          >
            {controller.utilities.unreadNotificationCount} 条未读
          </ProductTag>
        </header>
        {controller.utilities.notifications.length ? (
          <div className={styles.notificationList}>
            {controller.utilities.notifications.map((notification) => (
              <NotificationRow
                controller={controller}
                key={notification.id}
                notification={notification}
              />
            ))}
          </div>
        ) : (
          <SearchEmpty
            description="需要处理的学习、协作、同步与安全提醒会出现在这里。"
            title="暂无通知"
          />
        )}
      </section>
    </div>
  );
}

function CreateFeedSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: SearchControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState("");

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      setName("");
      setToken("");
    }
    onOpenChange(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const nextToken = await controller.commands.createFeed(name);
    setPending(false);
    if (nextToken) setToken(nextToken);
  }

  return (
    <WorkbenchSheet
      description="只投影任务、考试和复习的标题与时间；不包含正文、笔记或附件。"
      footer={
        token ? (
          <button
            className={styles.primaryButton}
            onClick={() => changeOpen(false)}
            type="button"
          >
            已保存，关闭
          </button>
        ) : (
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
              disabled={!name.trim() || pending}
              form={formId}
              type="submit"
            >
              {pending ? "正在创建" : "创建并显示地址"}
            </button>
          </>
        )
      }
      onOpenChange={changeOpen}
      open={open}
      title="创建只读日历订阅"
      trigger={
        <button
          className={styles.primaryButton}
          data-workbench-primary="true"
          disabled={!controller.capabilities.canManageUtilities}
          type="button"
        >
          <AppIcon name="calendar" size={15} />
          创建订阅
        </button>
      }
    >
      {token ? (
        <div className={styles.tokenReveal} role="status">
          <strong>一次性 URL</strong>
          <p>地址只在本次创建响应中显示。关闭后不能找回，只能撤销后重建。</p>
          <code>{`/api/v1/calendars/${token}.ics`}</code>
        </div>
      ) : (
        <form className={styles.sheetForm} id={formId} onSubmit={submit}>
          <label htmlFor={`${formId}-name`}>订阅名称</label>
          <input
            autoFocus
            id={`${formId}-name`}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：学习截止事项"
            required
            value={name}
          />
          <p>
            Token 采用高熵随机值，服务端只保存域分离哈希。地址泄露时请立即撤销。
          </p>
        </form>
      )}
    </WorkbenchSheet>
  );
}

function RevokeFeedSheet({
  controller,
  feed,
}: Readonly<{
  controller: SearchControllerResult;
  feed: CalendarFeed;
}>) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const workspace = controller.context.workspaces.find(
    (item) => item.id === controller.context.workspaceId,
  );

  function changeOpen(open: boolean) {
    if (!open) setConfirmation("");
    setOpen(open);
  }

  return (
    <WorkbenchSheet
      description="撤销后旧 URL 立即返回 404，订阅客户端不会再收到更新。"
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
            className={styles.dangerButton}
            disabled={confirmation !== "REVOKE" || pending}
            onClick={async () => {
              setPending(true);
              const revoked = await controller.commands.revokeFeed(feed);
              setPending(false);
              if (revoked) changeOpen(false);
            }}
            type="button"
          >
            {pending ? "正在撤销" : "永久撤销 URL"}
          </button>
        </>
      }
      onOpenChange={changeOpen}
      open={open}
      title={`撤销“${feed.name}”`}
      trigger={
        <button
          className={styles.dangerTextButton}
          disabled={!controller.capabilities.canManageUtilities}
          type="button"
        >
          撤销
        </button>
      }
    >
      <div className={styles.dangerSummary}>
        <dl>
          <div>
            <dt>影响对象</dt>
            <dd>{feed.name}</dd>
          </div>
          <div>
            <dt>影响范围</dt>
            <dd>所有已添加该 URL 的日历客户端</dd>
          </div>
          <div>
            <dt>当前权限</dt>
            <dd>{workspace?.role ?? "未知"}</dd>
          </div>
          <div>
            <dt>可撤销性</dt>
            <dd>不可恢复；需要创建新订阅并重新分发 URL</dd>
          </div>
        </dl>
        <label>
          输入 REVOKE 确认
          <input
            autoFocus
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
        </label>
      </div>
    </WorkbenchSheet>
  );
}

function CalendarPanel({ controller }: { controller: SearchControllerResult }) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className={styles.utilityPanel}>
      <p aria-live="polite" className={styles.statusLine} role="status">
        {controller.context.status}
      </p>
      <section className={styles.calendarSection}>
        <header className={styles.utilityHeader}>
          <div>
            <p className={styles.eyebrow}>READ-ONLY FEEDS</p>
            <h2>日历订阅</h2>
          </div>
          <CreateFeedSheet
            controller={controller}
            onOpenChange={setCreateOpen}
            open={createOpen}
          />
        </header>
        <p className={styles.calendarNotice}>
          日历仅包含任务、考试和复习的标题与时间；不包含任务说明、笔记、附件或正文。
        </p>
        {controller.utilities.feeds.length ? (
          <div className={styles.feedList}>
            {controller.utilities.feeds.map((feed) => (
              <article className={styles.feedRow} key={feed.id}>
                <span aria-hidden="true">
                  <AppIcon name="calendar" size={17} />
                </span>
                <div>
                  <strong>{feed.name}</strong>
                  <small>创建于 {formatDate(feed.created_at)}</small>
                </div>
                <ProductTag tone={feed.status === "active" ? "good" : "bad"}>
                  {feed.status === "active" ? "生效中" : "已撤销"}
                </ProductTag>
                {feed.status === "active" ? (
                  <RevokeFeedSheet controller={controller} feed={feed} />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <SearchEmpty
            description="创建后把一次性地址添加到日历应用；地址可随时撤销。"
            title="尚无日历订阅"
          />
        )}
      </section>
    </div>
  );
}

export function SearchWorkbench({
  controller,
  onScopeChange,
  scope,
}: Readonly<{
  controller: SearchControllerResult;
  onScopeChange: (scope: SearchScope) => void;
  scope: SearchScope;
}>) {
  const [tab, setTab] = useState<SearchTab>("search");
  return (
    <main className={styles.root} id="main-content">
      <WorkbenchHeader
        description={
          <>
            <span>
              一个入口找到内容和下一步行动；通知与日历是清晰分离的子模式。
            </span>
            <small>查询正文不会写入日志或发送给第三方服务。</small>
          </>
        }
        eyebrow="SEARCH · NOTIFICATIONS · CALENDAR"
        title="统一入口"
      />
      <div data-testid="search-utilities">
        <WorkbenchTabs
          label="搜索与通知模式"
          onValueChange={(value) => setTab(value as SearchTab)}
          tabs={[
            { label: "搜索", value: "search" },
            {
              count: controller.utilities.unreadNotificationCount,
              label: "通知",
              value: "notifications",
            },
            { label: "日历", value: "calendar" },
          ]}
          value={tab}
        >
          <WorkbenchTabPanel value="search">
            <SearchPanel
              controller={controller}
              onScopeChange={onScopeChange}
              scope={scope}
            />
          </WorkbenchTabPanel>
          <WorkbenchTabPanel value="notifications">
            <NotificationsPanel controller={controller} />
          </WorkbenchTabPanel>
          <WorkbenchTabPanel value="calendar">
            <CalendarPanel controller={controller} />
          </WorkbenchTabPanel>
        </WorkbenchTabs>
      </div>
    </main>
  );
}
