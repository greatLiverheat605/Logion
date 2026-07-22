"use client";

import type { components } from "@logion/contracts";
import type {
  LogionOfflineDatabase,
  OfflineSearchResult,
  OfflineSearchRepository,
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
type ServerSearchResult = components["schemas"]["SearchResult"];
type Notification = components["schemas"]["NotificationResponse"];
type Preference = components["schemas"]["NotificationPreferenceResponse"];
type Feed = components["schemas"]["CalendarFeedResponse"];
type DisplayResult = Pick<
  ServerSearchResult,
  "object_id" | "object_type" | "snippet" | "title" | "updated_at"
> & { permission_source: string };

const CATEGORIES = [
  "learning",
  "collaboration",
  "sync",
  "security",
  "ai",
  "billing",
  "system",
] as const;

function errorText(error: unknown) {
  if (error instanceof LogionApiError)
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  return "操作未完成；离线学习数据不受影响。";
}

function offlineResult(row: OfflineSearchResult): DisplayResult {
  const objectType =
    row.entity_type === "learning_goal"
      ? "goal"
      : row.entity_type === "paper_record"
        ? "paper"
        : row.entity_type;
  return {
    object_id: row.entity_id,
    object_type: objectType as DisplayResult["object_type"],
    title: row.title,
    snippet: row.snippet,
    permission_source: "offline_cache",
    updated_at: row.updated_at,
  };
}

export function EngagementCenter() {
  const { state: session } = useSession();
  const database = useRef<LogionOfflineDatabase | null>(null);
  const offlineSearch = useRef<OfflineSearchRepository | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [results, setResults] = useState<DisplayResult[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [calendarToken, setCalendarToken] = useState("");
  const [offlineUnlocked, setOfflineUnlocked] = useState(false);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState(
    "搜索不会把查询正文写入日志或第三方服务。",
  );

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces");
      const next = Array.isArray(result.workspaces) ? result.workspaces : [];
      setWorkspaces(next);
      setWorkspaceId((current) =>
        next.some((item) => item.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }, []);

  const loadData = useCallback(async (selected: string) => {
    try {
      const [notificationResult, preferenceResult, feedResult] =
        await Promise.all([
          browserApiClient.request<{ notifications: Notification[] }>(
            `/api/v1/workspaces/${selected}/notifications`,
          ),
          browserApiClient.request<Preference>(
            `/api/v1/workspaces/${selected}/notification-preferences`,
          ),
          browserApiClient.request<{ feeds: Feed[] }>(
            `/api/v1/workspaces/${selected}/calendar-feeds`,
          ),
        ]);
      setNotifications(
        Array.isArray(notificationResult.notifications)
          ? notificationResult.notifications
          : [],
      );
      setPreference(preferenceResult);
      setFeeds(Array.isArray(feedResult.feeds) ? feedResult.feeds : []);
      setDataWorkspaceId(selected);
    } catch (error) {
      setNotifications([]);
      setPreference(null);
      setFeeds([]);
      setDataWorkspaceId(selected);
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      database.current?.close();
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId && online) queueMicrotask(() => void loadData(workspaceId));
  }, [loadData, online, workspaceId]);

  const visibleNotifications =
    dataWorkspaceId === workspaceId ? notifications : [];
  const visibleFeeds = dataWorkspaceId === workspaceId ? feeds : [];
  const visiblePreference = dataWorkspaceId === workspaceId ? preference : null;

  async function unlockOffline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    try {
      const {
        databaseNameForUser,
        OfflineSearchRepository,
        OfflineVault,
        openOfflineDatabase,
      } = await import("@logion/offline");
      const db = await openOfflineDatabase({
        databaseName: databaseNameForUser(session.user.id),
        indexedDB: globalThis.indexedDB ?? null,
        IDBKeyRange: globalThis.IDBKeyRange ?? null,
      });
      if ((await db.vaultMetadata.get(session.user.id)) === undefined) {
        db.close();
        setStatus(
          "本设备尚未初始化离线保险箱，请先在学习页面完成初始化与同步。",
        );
        return;
      }
      const localVault = new OfflineVault(db);
      await localVault.unlock(
        session.user.id,
        String(new FormData(event.currentTarget).get("passphrase") ?? ""),
      );
      database.current?.close();
      database.current = db;
      offlineSearch.current = new OfflineSearchRepository(db, localVault);
      setOfflineUnlocked(true);
      setStatus("离线搜索已解锁，只检索本设备已缓存且未删除的数据。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const query = String(new FormData(event.currentTarget).get("query") ?? "");
    try {
      if (online) {
        const response = await browserApiClient.request<{
          results: ServerSearchResult[];
        }>(`/api/v1/workspaces/${workspaceId}/search`, {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ query, limit: 30 }),
        });
        setResults(response.results);
        setStatus(`在线搜索完成，共 ${response.results.length} 条。`);
      } else {
        if (!offlineSearch.current || !offlineUnlocked)
          throw new Error("offline vault locked");
        const local = await offlineSearch.current.search(
          workspaceId,
          query,
          30,
        );
        setResults(local.map(offlineResult));
        setStatus(`离线搜索完成，共 ${local.length} 条本机缓存结果。`);
      }
    } catch (error) {
      setStatus(
        !online && !offlineUnlocked
          ? "离线搜索前需要解锁本设备保险箱。"
          : errorText(error),
      );
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !online) return;
    const data = new FormData(event.currentTarget);
    const categories = new Set(data.getAll("categories").map(String));
    categories.add("security");
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/notification-preferences`,
        {
          method: "PUT",
          csrf: true,
          body: JSON.stringify({
            expected_version: visiblePreference?.version || null,
            enabled_categories: [...categories],
            timezone: String(data.get("timezone") ?? "UTC"),
            quiet_start_minute: String(data.get("quiet_start_minute") ?? "")
              ? Number(data.get("quiet_start_minute"))
              : null,
            quiet_end_minute: String(data.get("quiet_end_minute") ?? "")
              ? Number(data.get("quiet_end_minute"))
              : null,
          }),
        },
      );
      await loadData(workspaceId);
      setStatus("通知偏好已保存；安全通知始终保留。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function markRead(notification: Notification) {
    if (!workspaceId || !online) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/notifications/${notification.id}/read`,
        { method: "POST", csrf: true, body: JSON.stringify({ read: true }) },
      );
      await loadData(workspaceId);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function createFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !online) return;
    try {
      const result = await browserApiClient.request<{ token: string }>(
        `/api/v1/workspaces/${workspaceId}/calendar-feeds`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name: String(new FormData(event.currentTarget).get("name") ?? ""),
          }),
        },
      );
      setCalendarToken(result.token);
      event.currentTarget.reset();
      await loadData(workspaceId);
      setStatus("日历订阅已创建。请立即保存一次性 URL。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function revokeFeed(feed: Feed) {
    if (!workspaceId || !online) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/calendar-feeds/${feed.id}/revoke`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ expected_version: feed.version }),
        },
      );
      await loadData(workspaceId);
      setStatus("日历订阅已撤销，原 URL 立即失效。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · FIND & REMIND</p>
        <h1>搜索、通知与日历</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <label htmlFor="engagement-workspace">工作区</label>
        <select
          id="engagement-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </section>
      <section className="settings-card">
        <h2>统一搜索</h2>
        <form className="planning-form" onSubmit={search}>
          <label>
            查询
            <input name="query" minLength={2} maxLength={100} required />
          </label>
          <button>搜索{online ? "服务器" : "本机缓存"}</button>
        </form>
        <form className="planning-form" onSubmit={unlockOffline}>
          <label>
            离线保险箱口令
            <input
              name="passphrase"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={offlineUnlocked}>解锁离线搜索</button>
        </form>
        <ul className="item-list">
          {results.map((result) => (
            <li key={`${result.object_type}:${result.object_id}`}>
              <span>
                <strong>{result.title}</strong>
                <small>
                  {result.object_type} · {result.permission_source}
                </small>
                <span>{result.snippet}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>通知偏好</h2>
        <form
          key={visiblePreference?.version ?? 0}
          className="planning-form"
          onSubmit={savePreferences}
        >
          <fieldset>
            <legend>类别</legend>
            {CATEGORIES.map((category) => (
              <label key={category}>
                <input
                  name="categories"
                  type="checkbox"
                  value={category}
                  defaultChecked={
                    visiblePreference?.enabled_categories.includes(category) ??
                    true
                  }
                  disabled={category === "security"}
                />
                {category}
                {category === "security" ? "（不可关闭）" : ""}
              </label>
            ))}
          </fieldset>
          <label>
            时区
            <input
              name="timezone"
              defaultValue={visiblePreference?.timezone ?? "UTC"}
              required
            />
          </label>
          <label>
            安静时间开始（0–1439 分钟）
            <input
              name="quiet_start_minute"
              type="number"
              min={0}
              max={1439}
              defaultValue={visiblePreference?.quiet_start_minute ?? ""}
            />
          </label>
          <label>
            安静时间结束（0–1439 分钟）
            <input
              name="quiet_end_minute"
              type="number"
              min={0}
              max={1439}
              defaultValue={visiblePreference?.quiet_end_minute ?? ""}
            />
          </label>
          <button disabled={!online}>保存通知偏好</button>
        </form>
        <ul className="item-list">
          {visibleNotifications.map((notification) => (
            <li key={notification.id}>
              <span>
                <strong>{notification.title}</strong>
                <small>
                  {notification.category} · {notification.summary}
                </small>
              </span>
              {notification.read_at ? null : (
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => void markRead(notification)}
                >
                  标为已读
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>只读日历订阅</h2>
        <p>订阅仅包含任务、考试和复习标题/时间，不包含笔记、附件或错题正文。</p>
        <form className="planning-form" onSubmit={createFeed}>
          <label>
            订阅名称
            <input name="name" maxLength={120} required />
          </label>
          <button disabled={!online}>创建订阅</button>
        </form>
        {calendarToken ? (
          <p role="status">
            一次性 URL：
            <a href={`/api/v1/calendars/${calendarToken}.ics`} rel="noreferrer">
              /api/v1/calendars/{calendarToken}.ics
            </a>
          </p>
        ) : null}
        <ul className="item-list">
          {visibleFeeds.map((feed) => (
            <li key={feed.id}>
              <span>
                <strong>{feed.name}</strong>
                <small>{feed.status}</small>
              </span>
              {feed.status === "active" ? (
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => void revokeFeed(feed)}
                >
                  撤销
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
