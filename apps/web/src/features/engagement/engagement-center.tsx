"use client";

import type { components } from "@logion/contracts";
import {
  OfflineSearchRepository,
  type OfflineSearchResult,
} from "@logion/offline";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ProductDisclosure,
  ProductEmptyState,
  ProductHero,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";
import { useSession } from "@/features/auth/session-provider";
import { integrationCapabilityService } from "@/features/integrations/integration-capability-service";
import type { CalendarFeed as Feed } from "@/features/integrations/integration-capability-model";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import {
  announceNotificationWorkspace,
  NOTIFICATION_CATEGORIES,
  visibleNotifications as filterVisibleNotifications,
} from "./notification-center-model";

type Workspace = components["schemas"]["WorkspaceResponse"];
type ServerSearchResult = components["schemas"]["SearchResult"];
type Notification = components["schemas"]["NotificationResponse"];
type Preference = components["schemas"]["NotificationPreferenceResponse"];
type DisplayResult = Pick<
  ServerSearchResult,
  "object_id" | "object_type" | "snippet" | "title" | "updated_at"
> & { permission_source: string };

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
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const offlineSearch = useRef<OfflineSearchRepository | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [results, setResults] = useState<DisplayResult[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [calendarToken, setCalendarToken] = useState("");
  const offlineUnlocked = vaultPhase === "unlocked";
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState(
    "搜索不会把查询正文写入日志或第三方服务。",
  );

  const loadWorkspaces = useCallback(async () => {
    try {
      const next = await integrationCapabilityService.listWorkspaces();
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
          integrationCapabilityService.listCalendarFeeds(selected),
        ]);
      setNotifications(
        Array.isArray(notificationResult.notifications)
          ? filterVisibleNotifications(notificationResult.notifications)
          : [],
      );
      setPreference(preferenceResult);
      setFeeds(feedResult);
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
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId && online) queueMicrotask(() => void loadData(workspaceId));
  }, [loadData, online, workspaceId]);

  useEffect(() => {
    if (offlineUnlocked && database.current && vault.current) {
      offlineSearch.current = new OfflineSearchRepository(
        database.current,
        vault.current,
      );
    } else {
      offlineSearch.current = null;
    }
  }, [database, offlineUnlocked, vault, vaultRevision]);

  const visibleNotifications =
    dataWorkspaceId === workspaceId ? notifications : [];
  const visibleFeeds = dataWorkspaceId === workspaceId ? feeds : [];
  const visiblePreference = dataWorkspaceId === workspaceId ? preference : null;

  async function unlockOffline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    try {
      const { database: db, vault: localVault } = await unlockVault(
        String(new FormData(event.currentTarget).get("passphrase") ?? ""),
      );
      offlineSearch.current = new OfflineSearchRepository(db, localVault);
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
      announceNotificationWorkspace(workspaceId);
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
      announceNotificationWorkspace(workspaceId);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function createFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !online) return;
    try {
      const result = await integrationCapabilityService.createCalendarFeed(
        workspaceId,
        {
          id: crypto.randomUUID(),
          name: String(new FormData(event.currentTarget).get("name") ?? ""),
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
      await integrationCapabilityService.revokeCalendarFeed(
        workspaceId,
        feed.id,
        feed.version,
      );
      await loadData(workspaceId);
      setStatus("日历订阅已撤销，原 URL 立即失效。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  const unreadNotifications = visibleNotifications.filter(
    (notification) => notification.read_at === null,
  ).length;
  const activeFeeds = visibleFeeds.filter(
    (feed) => feed.status === "active",
  ).length;

  return (
    <main id="main-content" className="settings-page">
      <ProductPageHeader
        eyebrow="SEARCH · NOTIFICATIONS · CALENDAR"
        title="在一个入口找到内容和下一步行动"
        description={
          <>
            <p>
              统一搜索覆盖笔记、任务、资料、实验与审计摘要；通知和日历只保留需要处理的上下文。
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
      />
      <ProductHero
        badge={
          <ProductTag tone={online ? "good" : "warn"}>
            {online ? "在线检索" : "离线缓存"}
          </ProductTag>
        }
        title={
          results.length
            ? `找到 ${results.length} 项相关内容`
            : "搜索目标、笔记、论文与任务"
        }
        progressLabel="离线资料可用"
        progressValue={offlineUnlocked ? 100 : 0}
      >
        查询正文不会写入日志或发送给第三方；离线时可在解锁后的本机缓存中继续查找。
      </ProductHero>
      <div className="product-metric-grid">
        <ProductMetric
          label="搜索结果"
          value={results.length}
          detail={online ? "服务器权限过滤" : "本机缓存"}
          tone="info"
        />
        <ProductMetric
          label="未读通知"
          value={unreadNotifications}
          detail={`${visibleNotifications.length} 条通知`}
          tone={unreadNotifications ? "warn" : "good"}
        />
        <ProductMetric label="日历订阅" value={activeFeeds} detail="当前有效" />
        <ProductMetric
          label="离线搜索"
          value={offlineUnlocked ? "已解锁" : "未解锁"}
          detail="本地保险箱"
          tone={offlineUnlocked ? "good" : "default"}
        />
      </div>

      <ProductDisclosure
        summary="搜索工作区"
        description="所有服务器搜索结果继续遵循现有权限过滤"
      >
        <label htmlFor="engagement-workspace">工作区</label>
        <select
          id="engagement-workspace"
          value={workspaceId}
          onChange={(event) => {
            const selected = event.target.value;
            setWorkspaceId(selected);
            announceNotificationWorkspace(selected);
          }}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </ProductDisclosure>

      <ProductPanel
        title="统一搜索"
        description="在线搜索服务器索引，离线搜索已解锁的本机缓存。"
        aside={<ProductTag tone="info">{results.length} 项结果</ProductTag>}
      >
        <div className="product-search-controls">
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
        </div>
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
        {results.length === 0 ? (
          <ProductEmptyState
            icon="⌕"
            title="输入关键词开始搜索"
            description="至少输入两个字符；可搜索目标、任务、笔记、论文等现有内容。"
          />
        ) : null}
      </ProductPanel>

      <ProductDisclosure
        summary="通知偏好"
        description="设置类别、时区和安静时间；安全通知不可关闭"
      >
        <form
          key={visiblePreference?.version ?? 0}
          className="planning-form"
          onSubmit={savePreferences}
        >
          <fieldset>
            <legend>类别</legend>
            {NOTIFICATION_CATEGORIES.map((category) => (
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
      </ProductDisclosure>

      <ProductPanel
        title="通知中心"
        description="集中处理学习、协作、同步与安全提醒。"
        aside={
          <ProductTag tone={unreadNotifications ? "warn" : "good"}>
            {unreadNotifications} 条未读
          </ProductTag>
        }
      >
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
        {visibleNotifications.length === 0 ? (
          <ProductEmptyState
            icon="✓"
            title="暂无通知"
            description="需要处理的学习、协作、同步与安全提醒会出现在这里。"
          />
        ) : null}
      </ProductPanel>

      <ProductDisclosure
        summary="创建只读日历订阅"
        description="只包含任务、考试和复习标题/时间"
      >
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
      </ProductDisclosure>

      <ProductPanel
        title="日历订阅"
        description="查看现有订阅状态，并随时撤销 URL。"
        aside={<ProductTag>{activeFeeds} 个有效</ProductTag>}
      >
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
        {visibleFeeds.length === 0 ? (
          <ProductEmptyState
            icon="□"
            title="尚无日历订阅"
            description="需要在日历中查看任务、考试和复习时间时，再创建只读订阅。"
          />
        ) : null}
      </ProductPanel>
    </main>
  );
}
