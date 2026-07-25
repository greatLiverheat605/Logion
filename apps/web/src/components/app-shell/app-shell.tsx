"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { LogoutButton } from "@/features/auth/logout-button";

type Overlay = "command" | "notifications" | "capture" | "focus";
type NavItem = Readonly<{ href: string; icon: string; label: string }>;

const NAV_GROUPS: readonly Readonly<{
  label: string;
  items: readonly NavItem[];
}>[] = [
  {
    label: "学习与执行",
    items: [
      { href: "/app/today", icon: "⌂", label: "今日" },
      { href: "/app/planning", icon: "⌁", label: "计划" },
      { href: "/app/review", icon: "◉", label: "复习与掌握" },
      { href: "/app/exam", icon: "◇", label: "备考" },
    ],
  },
  {
    label: "知识与研究",
    items: [
      { href: "/app/records", icon: "▱", label: "资料与笔记" },
      { href: "/app/self-study", icon: "▤", label: "自主学习" },
      { href: "/app/research", icon: "⌬", label: "研究证据" },
      { href: "/app/collaboration", icon: "◎", label: "导师与小组" },
    ],
  },
  {
    label: "系统与治理",
    items: [
      { href: "/app/ai", icon: "✦", label: "AI Provider" },
      { href: "/app/templates", icon: "▦", label: "模板与分享" },
      { href: "/app/search", icon: "⌕", label: "搜索通知日历" },
      { href: "/app/sync", icon: "⇄", label: "同步与设备" },
      { href: "/app/workspaces", icon: "⬡", label: "工作区" },
      { href: "/app/data", icon: "⇩", label: "数据主权" },
      { href: "/app/security", icon: "◈", label: "账户安全" },
      { href: "/app/audit", icon: "▣", label: "安全审计" },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
const DEFAULT_NAV_ITEM: NavItem = {
  href: "/app/today",
  icon: "⌂",
  label: "今日",
};
const MOBILE_HREFS = new Set([
  "/app/today",
  "/app/planning",
  "/app/review",
  "/app/research",
]);

function AppModal({
  children,
  eyebrow,
  onClose,
  title,
}: Readonly<{
  children: ReactNode;
  eyebrow: string;
  onClose: () => void;
  title: string;
}>) {
  return (
    <div className="app-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={title}
        aria-modal="true"
        className="app-modal panel"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="app-modal-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button
            aria-label="关闭"
            className="app-icon-button"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [query, setQuery] = useState("");

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
            <strong>工作区</strong>
            <span>⌄</span>
          </span>
          <span className="workspace-privacy">选择或管理当前工作区</span>
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
                      {item.icon}
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
              ☰
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
              type="button"
              onClick={() => setOverlay("command")}
            >
              <span>⌕ 搜索、导航或执行命令…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              aria-label="打开专注计时"
              className="app-icon-button"
              type="button"
              onClick={() => setOverlay("focus")}
            >
              ◷
            </button>
            <button
              aria-label="打开通知中心"
              className="app-icon-button"
              type="button"
              onClick={() => setOverlay("notifications")}
            >
              ◇
            </button>
            <button
              className="app-primary-button"
              type="button"
              onClick={() => setOverlay("capture")}
            >
              ＋ <span className="top-action-label">捕获</span>
            </button>
          </div>
        </header>
        <div className="app-content">{children}</div>
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
            <b aria-hidden="true">{item.icon}</b>
            <span>{item.label}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setMenuOpen(true)}>
          <b aria-hidden="true">•••</b>
          <span>更多</span>
        </button>
      </nav>

      {overlay === "command" ? (
        <AppModal
          eyebrow="COMMAND PALETTE"
          title="搜索与跳转"
          onClose={() => setOverlay(null)}
        >
          <label className="sr-only" htmlFor="app-command-input">
            搜索页面
          </label>
          <input
            autoFocus
            className="app-command-input"
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
                <span aria-hidden="true">{item.icon}</span>
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

      {overlay === "capture" ? (
        <AppModal
          eyebrow="UNIVERSAL CAPTURE"
          title="快速捕获"
          onClose={() => setOverlay(null)}
        >
          <p className="muted">
            使用现有收件箱保存任务，或进入资料页记录内容。
          </p>
          <div className="app-modal-actions">
            <Link
              className="app-primary-link"
              href="/app/self-study"
              onClick={closeTransientUi}
            >
              前往快速收件箱
            </Link>
            <Link
              className="app-secondary-link"
              href="/app/records"
              onClick={closeTransientUi}
            >
              前往资料与笔记
            </Link>
          </div>
        </AppModal>
      ) : null}

      {overlay === "focus" ? (
        <AppModal
          eyebrow="FOCUS SESSION"
          title="专注计时"
          onClose={() => setOverlay(null)}
        >
          <div className="app-focus-stage">
            <div aria-hidden="true" className="app-focus-clock">
              25:00
            </div>
            <p className="muted">从今日中心选择真实任务后开始专注记录。</p>
            <Link
              className="app-primary-link"
              href="/app/today"
              onClick={closeTransientUi}
            >
              打开今日中心
            </Link>
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
