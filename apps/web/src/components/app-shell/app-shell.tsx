"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import { AppModal } from "@/components/app-shell/app-modal";
import { AppOperationalTools } from "@/components/app-shell/app-operational-tools";
import { LogoutButton } from "@/features/auth/logout-button";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";

type Overlay = "command" | "notifications";
type Theme = "light" | "dark";
type NavItem = Readonly<{ href: string; icon: AppIconName; label: string }>;

const NAV_GROUPS: readonly Readonly<{
  label: string;
  items: readonly NavItem[];
}>[] = [
  {
    label: "学习与执行",
    items: [
      { href: "/app/today", icon: "home", label: "今日" },
      { href: "/app/planning", icon: "calendar", label: "计划" },
      { href: "/app/review", icon: "refresh", label: "复习与掌握" },
      { href: "/app/exam", icon: "target", label: "备考" },
    ],
  },
  {
    label: "知识与研究",
    items: [
      { href: "/app/records", icon: "files", label: "资料与笔记" },
      { href: "/app/self-study", icon: "book-open", label: "自主学习" },
      { href: "/app/research", icon: "flask", label: "研究证据" },
      { href: "/app/collaboration", icon: "users", label: "导师与小组" },
    ],
  },
  {
    label: "系统与治理",
    items: [
      { href: "/app/ai", icon: "ai", label: "AI Provider" },
      { href: "/app/templates", icon: "layout-template", label: "模板与分享" },
      { href: "/app/search", icon: "search", label: "搜索通知日历" },
      { href: "/app/sync", icon: "refresh", label: "同步与设备" },
      { href: "/app/workspaces", icon: "folder", label: "工作区" },
      { href: "/app/data", icon: "download", label: "数据主权" },
      { href: "/app/security", icon: "shield", label: "账户安全" },
      { href: "/app/audit", icon: "clipboard", label: "安全审计" },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
const DEFAULT_NAV_ITEM: NavItem = {
  href: "/app/today",
  icon: "home",
  label: "今日",
};
const MOBILE_HREFS = new Set([
  "/app/today",
  "/app/planning",
  "/app/review",
  "/app/research",
]);

function subscribeToTheme(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
    attributes: true,
  });
  return () => observer.disconnect();
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { state: session } = useSession();
  const { phase: vaultPhase } = useVaultSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [query, setQuery] = useState("");
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const current =
    NAV_ITEMS.find((item) => item.href === pathname) ?? DEFAULT_NAV_ITEM;
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  const results = needle
    ? NAV_ITEMS.filter((item) =>
        item.label.toLocaleLowerCase("zh-CN").includes(needle),
      )
    : NAV_ITEMS;
  const closeTransientUi = () => {
    setMenuOpen(false);
    setOverlay(null);
  };
  const accountLabel =
    session.status === "authenticated"
      ? session.user.email.split("@", 1)[0] || "学习者"
      : "学习者";
  const accountInitial = accountLabel.slice(0, 1).toLocaleUpperCase("zh-CN");

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

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("app-shell-theme", next);
    } catch {
      // The visible theme still changes when storage is unavailable.
    }
  };

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
          {NAV_GROUPS.map((group) => (
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
            <button
              aria-label={
                theme === "dark" ? "切换到浅色主题" : "切换到深色主题"
              }
              className="app-icon-button"
              title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              type="button"
              onClick={toggleTheme}
            >
              <AppIcon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <AppOperationalTools />
            <button
              aria-label="打开通知中心"
              className="app-icon-button"
              type="button"
              onClick={() => setOverlay("notifications")}
            >
              <AppIcon name="bell" />
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
        {NAV_ITEMS.filter((item) => MOBILE_HREFS.has(item.href)).map((item) => (
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
        <button type="button" onClick={() => setMenuOpen(true)}>
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
          title="搜索与跳转"
          onClose={() => setOverlay(null)}
        >
          <label className="sr-only" htmlFor="app-command-input">
            搜索页面
          </label>
          <input
            className="app-command-input"
            data-modal-autofocus
            id="app-command-input"
            placeholder="例如：复习、研究、同步…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="app-command-results">
            {results.map((item) => (
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
            {results.length === 0 ? (
              <p className="app-empty-note">没有匹配页面。</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}

      {overlay === "notifications" ? (
        <AppModal
          eyebrow="NOTIFICATION CENTER"
          title="通知中心"
          onClose={() => setOverlay(null)}
        >
          <p className="muted">通知内容由现有通知中心实时加载。</p>
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
