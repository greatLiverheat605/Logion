"use client";

import type { components } from "@logion/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import { AppModal } from "@/components/app-shell/app-modal";
import {
  COMMAND_GROUPS,
  COMMAND_ITEMS,
  commandItemMatches,
  DEFAULT_NAV_ITEM,
  isCommandItemVisible,
  NAV_GROUPS,
  NAV_ITEMS,
} from "@/components/app-shell/app-navigation";
import { requestOperationalCommand } from "@/components/app-shell/app-operational-events";
import { AppOperationalTools } from "@/components/app-shell/app-operational-tools";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { LogoutButton } from "@/features/auth/logout-button";
import { useSession } from "@/features/auth/session-provider";
import {
  NOTIFICATION_CENTER_UPDATED_EVENT,
  notificationSummary,
} from "@/features/engagement/notification-center-model";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { mobileNavigationForPersona } from "@/features/personas/mobile-persona-navigation";
import { usePersona } from "@/features/personas/persona-context";
import { browserApiClient } from "@/lib/api/client";

type Overlay = "command" | "mobile-more" | "notifications";
type Workspace = components["schemas"]["WorkspaceResponse"];
type Notification = components["schemas"]["NotificationResponse"];

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { state: session } = useSession();
  const { phase: vaultPhase } = useVaultSession();
  const {
    activePersona,
    isLoading: personaLoading,
    isRouteVisible,
  } = usePersona();
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [query, setQuery] = useState("");
  const [notificationState, setNotificationState] = useState<{
    latest: Notification[];
    status: "error" | "loading" | "ready";
    total: number;
    unread: number;
    workspaceId: string;
    workspaceName: string;
  }>({
    latest: [],
    status: "loading",
    total: 0,
    unread: 0,
    workspaceId: "",
    workspaceName: "",
  });
  const commandButtonRef = useRef<HTMLButtonElement>(null);

  const visibleNavGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => isRouteVisible(item.href)),
      })).filter((group) => group.items.length > 0),
    [isRouteVisible],
  );
  const mobileNavigation = useMemo(
    () =>
      activePersona === null
        ? { overflow: [], primary: [] }
        : mobileNavigationForPersona(activePersona),
    [activePersona],
  );
  const current =
    NAV_ITEMS.find((item) => item.href === pathname) ?? DEFAULT_NAV_ITEM;
  const commandResults = COMMAND_ITEMS.filter(
    (item) =>
      isCommandItemVisible(item, activePersona, isRouteVisible) &&
      commandItemMatches(item, query),
  );
  const groupedCommandResults = COMMAND_GROUPS.map((group) => ({
    group,
    items: commandResults.filter((item) => item.group === group),
  })).filter(({ items }) => items.length > 0);
  const closeTransientUi = () => {
    setMenuOpen(false);
    setOverlay(null);
  };
  const executeOperationalCommand = (command: "capture" | "focus") => {
    setOverlay(null);
    requestOperationalCommand(command);
  };
  const accountLabel =
    session.status === "authenticated"
      ? session.user.email.split("@", 1)[0] || "学习者"
      : "学习者";
  const accountInitial = accountLabel.slice(0, 1).toLocaleUpperCase("zh-CN");

  const loadNotificationSummary = useCallback(
    async (preferredWorkspaceId = "") => {
      if (session.status !== "authenticated") return;
      setNotificationState((current) => ({ ...current, status: "loading" }));
      try {
        const workspaceResult = await browserApiClient.request<{
          workspaces: Workspace[];
        }>("/api/v1/workspaces");
        const workspace =
          workspaceResult.workspaces.find(
            (item) => item.id === preferredWorkspaceId,
          ) ?? workspaceResult.workspaces[0];
        if (!workspace) {
          setNotificationState({
            latest: [],
            status: "ready",
            total: 0,
            unread: 0,
            workspaceId: "",
            workspaceName: "",
          });
          return;
        }
        const result = await browserApiClient.request<{
          notifications: Notification[];
        }>(`/api/v1/workspaces/${workspace.id}/notifications`);
        const summary = notificationSummary(
          Array.isArray(result.notifications) ? result.notifications : [],
        );
        setNotificationState({
          ...summary,
          status: "ready",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        });
      } catch {
        setNotificationState((current) => ({
          ...current,
          latest: [],
          status: "error",
          total: 0,
          unread: 0,
        }));
      }
    },
    [session.status],
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (session.status === "authenticated")
      queueMicrotask(() => void loadNotificationSummary());
    const refresh = (event: Event) => {
      const workspaceId =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail
          : "";
      void loadNotificationSummary(workspaceId);
    };
    window.addEventListener(NOTIFICATION_CENTER_UPDATED_EVENT, refresh);
    return () =>
      window.removeEventListener(NOTIFICATION_CENTER_UPDATED_EVENT, refresh);
  }, [loadNotificationSummary, session.status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOverlay("command");
      }
      if (event.key === "Escape") closeTransientUi();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-shell-frame">
      <aside
        aria-label="主导航"
        className={`app-sidebar${menuOpen ? " open" : ""}`}
      >
        <Link
          className="app-brand"
          href="/app/today"
          onClick={closeTransientUi}
        >
          <span aria-hidden="true" className="app-brand-mark">
            L
          </span>
          <span className="app-brand-name">
            LOGION<small>LEARNING INTELLIGENCE OS</small>
          </span>
        </Link>
        <Link
          className="workspace-switch"
          href="/app/workspaces"
          onClick={closeTransientUi}
        >
          <span className="workspace-line">
            <strong>当前工作区</strong>
            <AppIcon aria-hidden="true" name="chevron-down" size={15} />
          </span>
          <span className="workspace-privacy">私有优先 · 点击选择或管理</span>
        </Link>
        <nav className="app-nav-scroll">
          {visibleNavGroups.map((group) => (
            <section className="app-nav-group" key={group.label}>
              <h2 className="app-nav-label">{group.label}</h2>
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`app-nav-link${active ? " active" : ""}`}
                    href={item.href}
                    key={item.href}
                    onClick={closeTransientUi}
                  >
                    <span aria-hidden="true" className="app-nav-icon">
                      <AppIcon name={item.icon} size={17} />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>
        <div className="app-sidebar-foot">
          <Link
            aria-label={
              activePersona
                ? `当前画像：${activePersona.name}，前往画像设置`
                : "画像加载中"
            }
            className="persona-indicator"
            href="/app/settings"
            onClick={closeTransientUi}
          >
            <span aria-hidden="true" className="persona-indicator-icon">
              {activePersona?.icon ?? "…"}
            </span>
            <span>
              <strong>{activePersona?.name ?? "画像加载中"}</strong>
              <small>
                {personaLoading ? "正在同步偏好" : activePersona?.description}
              </small>
            </span>
          </Link>
          <span className="tag good">PRIVATE BY DEFAULT</span>
          <div className="app-account-summary">
            <span aria-hidden="true" className="app-account-avatar">
              {accountInitial}
            </span>
            <span>
              <strong>{accountLabel}</strong>
              <small>个人学习者 · 本地优先</small>
            </span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {menuOpen ? (
        <button
          aria-label="关闭主导航"
          className="app-navigation-scrim"
          type="button"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="app-main-shell">
        <header className="app-topbar">
          <div className="app-top-left">
            <button
              aria-expanded={menuOpen}
              aria-label="打开主导航"
              className="app-icon-button app-mobile-menu"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <AppIcon name="menu" />
            </button>
            <span className="app-crumb">{current.label}</span>
            <span
              className={`app-system-status ${online ? "online" : "offline"}`}
            >
              {online ? "SYSTEM ONLINE" : "OFFLINE MODE"}
            </span>
          </div>
          <div className="app-top-actions">
            <button
              className="app-command-trigger"
              ref={commandButtonRef}
              type="button"
              onClick={() => setOverlay("command")}
            >
              <span className="app-command-copy">
                <AppIcon name="search" size={16} />
                搜索、导航或执行命令…
              </span>
              <kbd>Ctrl K</kbd>
            </button>
            <ThemeToggle className="app-icon-button" />
            <AppOperationalTools />
            <button
              aria-label="打开通知中心"
              className="app-icon-button app-notification-button"
              type="button"
              onClick={() => {
                setOverlay("notifications");
                void loadNotificationSummary(notificationState.workspaceId);
              }}
            >
              <AppIcon name="bell" />
              {notificationState.unread ? (
                <span aria-hidden="true" className="app-notification-count">
                  {notificationState.unread > 99
                    ? "99+"
                    : notificationState.unread}
                </span>
              ) : null}
            </button>
          </div>
        </header>
        <div
          className="app-content"
          key={vaultPhase === "unlocked" ? "vault-unlocked" : "vault-locked"}
        >
          {children}
        </div>
      </div>

      <nav aria-label="移动端导航" className="bottom-nav">
        {mobileNavigation.primary.map((item) => (
          <Link
            aria-current={pathname === item.href ? "page" : undefined}
            className={pathname === item.href ? "active" : ""}
            href={item.href}
            key={item.href}
            onClick={closeTransientUi}
          >
            <b aria-hidden="true">
              <AppIcon name={item.icon} size={18} />
            </b>
            <span>{item.label}</span>
          </Link>
        ))}
        <button
          aria-expanded={overlay === "mobile-more"}
          type="button"
          onClick={() => setOverlay("mobile-more")}
        >
          <b aria-hidden="true">
            <AppIcon name="more" size={18} />
          </b>
          <span>更多</span>
        </button>
      </nav>

      {overlay === "command" ? (
        <AppModal
          eyebrow="COMMAND PALETTE"
          returnFocusRef={commandButtonRef}
          title="搜索、跳转与执行"
          onClose={() => setOverlay(null)}
        >
          <label className="sr-only" htmlFor="app-command-input">
            搜索页面或命令
          </label>
          <input
            className="app-command-input"
            data-modal-autofocus
            id="app-command-input"
            placeholder="例如：复习、研究、同步或捕获…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="app-command-results">
            {groupedCommandResults.map(({ group, items }) => (
              <section className="app-command-group" key={group}>
                <h3>{group}</h3>
                {items.map((item) =>
                  item.kind === "route" ? (
                    <Link
                      className="app-command-result"
                      href={item.href}
                      key={item.id}
                      onClick={closeTransientUi}
                    >
                      <span aria-hidden="true">
                        <AppIcon name={item.icon} size={17} />
                      </span>
                      <span className="app-command-result-copy">
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span>打开</span>
                    </Link>
                  ) : (
                    <button
                      className="app-command-result"
                      key={item.id}
                      type="button"
                      onClick={() => executeOperationalCommand(item.action)}
                    >
                      <span aria-hidden="true">
                        <AppIcon name={item.icon} size={17} />
                      </span>
                      <span className="app-command-result-copy">
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span>执行</span>
                    </button>
                  ),
                )}
              </section>
            ))}
            {commandResults.length === 0 ? (
              <p className="app-empty-note">没有匹配页面或命令。</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}

      {overlay === "mobile-more" ? (
        <AppModal
          eyebrow="PERSONA NAVIGATION"
          title="更多"
          onClose={() => setOverlay(null)}
        >
          <div className="app-command-results">
            {mobileNavigation.overflow.map((item) => (
              <Link
                className="app-command-result"
                href={item.href}
                key={item.href}
                onClick={closeTransientUi}
              >
                <span aria-hidden="true">
                  <AppIcon name={item.icon} size={17} />
                </span>
                <strong>{item.label}</strong>
                <span>打开</span>
              </Link>
            ))}
            {mobileNavigation.overflow.length === 0 ? (
              <p className="app-empty-note">当前画像没有更多入口。</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}

      {overlay === "notifications" ? (
        <AppModal
          eyebrow="NOTIFICATION CENTER"
          title={
            notificationState.status === "ready"
              ? `${notificationState.unread} 条未读通知`
              : "通知中心"
          }
          onClose={() => setOverlay(null)}
        >
          <p className="muted">
            {notificationState.status === "loading"
              ? "正在读取真实通知中心…"
              : notificationState.status === "error"
                ? "通知暂时无法读取，请进入通知中心重试。"
                : notificationState.workspaceName
                  ? `${notificationState.workspaceName} · ${notificationState.total} 条通知`
                  : "当前没有可读取通知的工作区。"}
          </p>
          {notificationState.latest.length ? (
            <ul className="app-notification-summary">
              {notificationState.latest.map((notification) => (
                <li key={notification.id}>
                  <strong>{notification.title}</strong>
                  <small>
                    {notification.category} · {notification.summary}
                  </small>
                  {notification.read_at === null ? (
                    <span className="product-tag tone-warn">未读</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <Link
            className="app-primary-link"
            href="/app/search"
            onClick={closeTransientUi}
          >
            打开搜索、通知与日历
          </Link>
        </AppModal>
      ) : null}
    </div>
  );
}
