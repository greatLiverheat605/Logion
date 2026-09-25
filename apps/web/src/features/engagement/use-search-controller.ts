"use client";

import type { components } from "@logion/contracts";
import {
  OfflineSearchRepository,
  type OfflineSearchResult,
} from "@logion/offline";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ProductOperationalState,
  ProductOperationalStateKind,
} from "@/components/product/product-workbench-state";
import type { WorkbenchOperationalContext } from "@/components/product/workbench";
import { useSession } from "@/features/auth/session-provider";
import { integrationCapabilityService } from "@/features/integrations/integration-capability-service";
import type { CalendarFeed } from "@/features/integrations/integration-capability-model";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";
import {
  readWorkbenchContext,
  writeWorkbenchContext,
} from "@/lib/workbench-context";

import {
  announceNotificationWorkspace,
  NOTIFICATION_CATEGORIES,
  visibleNotifications as filterVisibleNotifications,
} from "./notification-center-model";

export type SearchObjectType =
  components["schemas"]["SearchResult"]["object_type"];
export type SearchMode = "all" | SearchObjectType;
export type SearchScope = "all" | "private" | "shared";
export type SearchNotification = components["schemas"]["NotificationResponse"];
export type SearchPreference =
  components["schemas"]["NotificationPreferenceResponse"];
export type SearchWorkspace = components["schemas"]["WorkspaceResponse"];
export type SearchSpace = components["schemas"]["SpaceResponse"];
type ServerSearchResult = components["schemas"]["SearchResult"];
type NotificationCategory =
  components["schemas"]["NotificationPreferenceUpdate"]["enabled_categories"][number];

export interface SearchDisplayResult {
  object_id: string;
  object_type: SearchObjectType;
  permission_source: ServerSearchResult["permission_source"] | "offline_cache";
  snippet: string;
  space_id: string | null;
  title: string;
  updated_at: string;
  workspace_id: string;
}

export interface SearchGroup {
  items: SearchDisplayResult[];
  type: SearchObjectType;
}

export interface SearchInput {
  spaceId?: string;
  mode: SearchMode;
  query: string;
}

export interface SearchPreferenceInput {
  enabledCategories: NotificationCategory[];
  quietEndMinute: number | null;
  quietStartMinute: number | null;
  timezone: string;
}

type Phase = "error" | "idle" | "loading" | "ready";

interface SearchIssue {
  utility?: boolean;
  kind: Exclude<
    ProductOperationalStateKind,
    "empty" | "loading" | "pending" | "stale" | "success"
  >;
  requestId?: string;
}

const SEARCH_TYPES: readonly SearchObjectType[] = [
  "goal",
  "task",
  "note",
  "resource",
  "paper",
];

export const SEARCH_COMMAND_KEYS = [
  "createFeed",
  "loadContext",
  "markRead",
  "resetSearch",
  "revokeFeed",
  "savePreferences",
  "search",
  "selectResult",
  "setWorkspaceId",
  "unlock",
] as const;

export function shouldApplySearchResponse(
  requestId: number,
  currentRequestId: number,
  requestWorkspaceId: string,
  currentWorkspaceId: string,
): boolean {
  return (
    requestId === currentRequestId && requestWorkspaceId === currentWorkspaceId
  );
}

export function filterSearchResults(
  results: readonly SearchDisplayResult[],
  scope: SearchScope,
): SearchDisplayResult[] {
  if (scope === "all") return [...results];
  return results.filter((result) =>
    scope === "shared"
      ? result.permission_source === "shared_space"
      : ["personal_record", "private_owner"].includes(result.permission_source),
  );
}

export function groupSearchResults(
  results: readonly SearchDisplayResult[],
): SearchGroup[] {
  return SEARCH_TYPES.map((type) => ({
    items: results.filter((result) => result.object_type === type),
    type,
  })).filter((group) => group.items.length > 0);
}

export function searchResultRoute(type: SearchObjectType): string {
  if (type === "goal") return "/app/planning";
  if (type === "task") return "/app/today";
  if (type === "note" || type === "resource") return "/app/records";
  return "/app/research";
}

function issueFrom(error: unknown): SearchIssue {
  if (error instanceof LogionApiError) {
    const kind =
      error.status === 403 || error.status === 404
        ? "permission"
        : error.status === 409
          ? "conflict"
          : error.code.includes("CAPABILITY")
            ? "capability-disabled"
            : "error";
    return { kind, requestId: error.requestId };
  }
  return { kind: "error" };
}

function errorText(error: unknown): string {
  if (error instanceof LogionApiError) {
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "操作未完成；已确认的数据保持不变。";
}

function offlineResult(
  row: OfflineSearchResult,
  workspaceId: string,
): SearchDisplayResult {
  const objectType =
    row.entity_type === "learning_goal"
      ? "goal"
      : row.entity_type === "paper_record"
        ? "paper"
        : row.entity_type;
  return {
    object_id: row.entity_id,
    object_type: objectType as SearchObjectType,
    permission_source: "offline_cache",
    snippet: row.snippet,
    space_id: null,
    title: row.title,
    updated_at: row.updated_at,
    workspace_id: workspaceId,
  };
}

export interface SearchControllerResult {
  capabilities: {
    canManageUtilities: boolean;
    canSearch: boolean;
    canUnlock: boolean;
  };
  commands: {
    createFeed: (name: string) => Promise<string | null>;
    loadContext: () => Promise<void>;
    markRead: (notification: SearchNotification) => Promise<boolean>;
    resetSearch: () => void;
    revokeFeed: (feed: CalendarFeed) => Promise<boolean>;
    savePreferences: (input: SearchPreferenceInput) => Promise<boolean>;
    search: (input: SearchInput) => Promise<boolean>;
    selectResult: (resultId: string) => void;
    setWorkspaceId: (workspaceId: string) => void;
    unlock: (passphrase: string) => Promise<boolean>;
  };
  context: {
    offlineUnlocked: boolean;
    online: boolean;
    operational: WorkbenchOperationalContext;
    operationalState: ProductOperationalState | null;
    status: string;
    workspaceId: string;
    workspaces: SearchWorkspace[];
  };
  search: {
    groups: SearchGroup[];
    lastQuery: string;
    phase: Phase;
    resultCount: number;
    searched: boolean;
    selectedResult: SearchDisplayResult | null;
  };
  utilities: {
    activeFeedCount: number;
    feeds: CalendarFeed[];
    notifications: SearchNotification[];
    preference: SearchPreference | null;
    spaces: SearchSpace[];
    unreadNotificationCount: number;
  };
}

export function useSearchController(
  scope: SearchScope,
): SearchControllerResult {
  const { state: session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : null;
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const offlineSearch = useRef<OfflineSearchRepository | null>(null);
  const workspaceIdRef = useRef("");
  const searchRequest = useRef(0);
  const dataRequest = useRef(0);
  const notificationRevision = useRef(0);
  const preferenceRevision = useRef(0);
  const contextRequest = useRef(0);
  const accountRef = useRef<string | null>(null);
  const scopeGeneration = useRef(0);
  const mutations = useRef(new Set<string>());
  const lastInput = useRef<SearchInput | null>(null);

  const [workspaces, setWorkspaces] = useState<SearchWorkspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState("");
  const [spaces, setSpaces] = useState<SearchSpace[]>([]);
  const [results, setResults] = useState<SearchDisplayResult[]>([]);
  const [notifications, setNotifications] = useState<SearchNotification[]>([]);
  const [preference, setPreference] = useState<SearchPreference | null>(null);
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [online, setOnline] = useState(true);
  const [contextPhase, setContextPhase] = useState<Phase>("loading");
  useEffect(() => {
    // Only the Workspace is kept; search text and filters are never stored.
    if (contextPhase === "ready" && workspaceId)
      writeWorkbenchContext("search", { workspaceId });
  }, [contextPhase, workspaceId]);
  const [searchPhase, setSearchPhase] = useState<Phase>("idle");
  const [issue, setIssue] = useState<SearchIssue | null>(null);
  const [searched, setSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [selectedResultId, setSelectedResultId] = useState("");
  const [status, setStatus] = useState(
    "搜索不会把查询正文写入日志或第三方服务。",
  );
  const offlineUnlocked = vaultPhase === "unlocked";
  const [stateAccount, setStateAccount] = useState(userId);
  if (stateAccount !== userId) {
    setStateAccount(userId);
    setWorkspaceIdState("");
    setDataWorkspaceId("");
    setWorkspaces([]);
    setNotifications([]);
    setPreference(null);
    setFeeds([]);
    setSpaces([]);
    setResults([]);
    setSelectedResultId("");
    setSearched(false);
    setSearchPhase("idle");
    setLastQuery("");
    setIssue(null);
    setStatus("搜索不会把查询正文写入日志或第三方服务。");
  }

  const captureScope = useCallback((selected: string) => {
    const generation = scopeGeneration.current;
    const account = accountRef.current;
    return () =>
      Boolean(account) &&
      account === accountRef.current &&
      generation === scopeGeneration.current &&
      selected === workspaceIdRef.current;
  }, []);

  const loadWorkspaces = useCallback(async () => {
    if (!userId || accountRef.current !== userId) return;
    const request = ++contextRequest.current;
    const isCurrent = () =>
      request === contextRequest.current && accountRef.current === userId;
    setContextPhase("loading");
    try {
      const next = await integrationCapabilityService.listWorkspaces();
      if (!isCurrent()) return;
      setWorkspaces(next);
      const stored = readWorkbenchContext("search").workspaceId;
      const resolved = next.some((item) => item.id === workspaceIdRef.current)
        ? workspaceIdRef.current
        : (next.find((item) => item.id === stored)?.id ?? next[0]?.id ?? "");
      if (resolved !== workspaceIdRef.current) scopeGeneration.current += 1;
      workspaceIdRef.current = resolved;
      setWorkspaceIdState(resolved);
      setContextPhase("ready");
      setIssue(null);
    } catch (error) {
      if (!isCurrent()) return;
      setContextPhase("error");
      setIssue(issueFrom(error));
      setStatus(errorText(error));
    }
  }, [userId]);

  const loadData = useCallback(
    async (selected: string) => {
      const isCurrent = captureScope(selected);
      if (!selected || !isCurrent()) return false;
      const requestId = ++dataRequest.current;
      const notificationVersion = notificationRevision.current;
      const preferenceVersion = preferenceRevision.current;
      try {
        const [notificationResult, preferenceResult, feedResult, spaceResult] =
          await Promise.all([
            browserApiClient.request<{ notifications: SearchNotification[] }>(
              `/api/v1/workspaces/${selected}/notifications`,
            ),
            browserApiClient.request<SearchPreference>(
              `/api/v1/workspaces/${selected}/notification-preferences`,
            ),
            integrationCapabilityService.listCalendarFeeds(selected),
            browserApiClient.request<{ spaces: SearchSpace[] }>(
              `/api/v1/workspaces/${selected}/spaces`,
            ),
          ]);
        if (requestId !== dataRequest.current || !isCurrent()) {
          return false;
        }
        if (notificationVersion === notificationRevision.current)
          setNotifications(
            Array.isArray(notificationResult.notifications)
              ? filterVisibleNotifications(
                  notificationResult.notifications.filter(
                    (item) => item.workspace_id === selected,
                  ),
                )
              : [],
          );
        if (preferenceVersion === preferenceRevision.current)
          setPreference(preferenceResult);
        setFeeds(feedResult);
        setSpaces(spaceResult.spaces);
        setDataWorkspaceId(selected);
        setIssue(null);
        setStatus("当前工作区的通知与日历已更新。");
        announceNotificationWorkspace(selected, accountRef.current!);
        return true;
      } catch (error) {
        if (requestId !== dataRequest.current || !isCurrent()) {
          return false;
        }
        // Keep already confirmed data while reporting a failed refresh.
        setDataWorkspaceId(selected);
        setIssue({ ...issueFrom(error), utility: true });
        setStatus(errorText(error));
        return false;
      }
    },
    [captureScope],
  );

  const loadContext = useCallback(async () => {
    await loadWorkspaces();
  }, [loadWorkspaces]);

  useLayoutEffect(() => {
    accountRef.current = userId;
    scopeGeneration.current += 1;
    contextRequest.current += 1;
    dataRequest.current += 1;
    searchRequest.current += 1;
    workspaceIdRef.current = "";
    lastInput.current = null;
    let active = true;
    if (userId)
      queueMicrotask(() => {
        if (active) void loadWorkspaces();
      });
    return () => {
      active = false;
      accountRef.current = null;
      scopeGeneration.current += 1;
      contextRequest.current += 1;
      dataRequest.current += 1;
      searchRequest.current += 1;
    };
  }, [loadWorkspaces, userId]);

  useEffect(() => {
    const updateOnline = () => {
      searchRequest.current += 1;
      setResults([]);
      setSelectedResultId("");
      setSearched(false);
      setSearchPhase("idle");
      setOnline(navigator.onLine);
    };
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

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

  function setWorkspaceId(nextWorkspaceId: string) {
    if (nextWorkspaceId === workspaceIdRef.current) return;
    if (!workspaces.some((item) => item.id === nextWorkspaceId)) return;
    workspaceIdRef.current = nextWorkspaceId;
    scopeGeneration.current += 1;
    contextRequest.current += 1;
    searchRequest.current += 1;
    dataRequest.current += 1;
    lastInput.current = null;
    setWorkspaceIdState(nextWorkspaceId);
    setDataWorkspaceId("");
    setNotifications([]);
    setPreference(null);
    setFeeds([]);
    setSpaces([]);
    setResults([]);
    setSelectedResultId("");
    setSearched(false);
    setSearchPhase("idle");
    setIssue(null);
    setStatus("正在读取当前工作区。");
    if (userId) announceNotificationWorkspace(nextWorkspaceId, userId);
  }

  async function unlock(passphrase: string): Promise<boolean> {
    if (session.status !== "authenticated" || !passphrase) return false;
    try {
      const { database: nextDatabase, vault: localVault } =
        await unlockVault(passphrase);
      offlineSearch.current = new OfflineSearchRepository(
        nextDatabase,
        localVault,
      );
      setIssue(null);
      setStatus("离线搜索已解锁，只检索本设备已缓存且未删除的数据。");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function search(input: SearchInput): Promise<boolean> {
    const query = input.query.trim();
    const selectedWorkspace = workspaceIdRef.current;
    if (!selectedWorkspace || query.length < 2 || query.length > 100) {
      setStatus("查询需要 2 至 100 个字符。");
      return false;
    }
    const requestId = ++searchRequest.current;
    if (!online && input.spaceId) {
      setResults([]);
      setSelectedResultId("");
      setSearchPhase("error");
      setStatus(
        "离线缓存不包含可核验的空间索引，请选择全部空间后搜索本机缓存。",
      );
      return false;
    }
    const objectTypes = input.mode === "all" ? SEARCH_TYPES : [input.mode];
    lastInput.current = { ...input, query };
    setLastQuery(query);
    setSearchPhase("loading");
    setIssue(null);
    try {
      const nextResults = online
        ? (
            await browserApiClient.request<{ results: ServerSearchResult[] }>(
              `/api/v1/workspaces/${selectedWorkspace}/search`,
              {
                body: JSON.stringify({
                  limit: 30,
                  ...(input.spaceId ? { space_id: input.spaceId } : {}),
                  object_types: objectTypes,
                  query,
                }),
                csrf: true,
                method: "POST",
              },
            )
          ).results
        : await (async () => {
            if (!offlineSearch.current || !offlineUnlocked) {
              throw new Error("offline vault locked");
            }
            const local = await offlineSearch.current.search(
              selectedWorkspace,
              query,
              30,
            );
            return local
              .map((row) => offlineResult(row, selectedWorkspace))
              .filter((row) => objectTypes.includes(row.object_type));
          })();
      if (
        !shouldApplySearchResponse(
          requestId,
          searchRequest.current,
          selectedWorkspace,
          workspaceIdRef.current,
        )
      ) {
        return false;
      }
      setResults(nextResults);
      setSelectedResultId(nextResults[0]?.object_id ?? "");
      setSearched(true);
      setSearchPhase("ready");
      setStatus(
        online
          ? `在线搜索完成，共 ${nextResults.length} 条。`
          : `离线搜索完成，共 ${nextResults.length} 条本机缓存结果。`,
      );
      return true;
    } catch (error) {
      if (
        !shouldApplySearchResponse(
          requestId,
          searchRequest.current,
          selectedWorkspace,
          workspaceIdRef.current,
        )
      ) {
        return false;
      }
      setSearchPhase("error");
      setIssue(
        !online && !offlineUnlocked ? { kind: "locked" } : issueFrom(error),
      );
      setStatus(
        !online && !offlineUnlocked
          ? "离线搜索前需要解锁本设备保险箱。"
          : errorText(error),
      );
      return false;
    }
  }

  function resetSearch() {
    searchRequest.current += 1;
    lastInput.current = null;
    setResults([]);
    setSelectedResultId("");
    setLastQuery("");
    setSearched(false);
    setSearchPhase("idle");
    setIssue(null);
    setStatus("已清除查询与筛选，可以开始新的搜索。");
  }

  async function savePreferences(
    input: SearchPreferenceInput,
  ): Promise<boolean> {
    const selectedWorkspace = workspaceIdRef.current;
    const visiblePreference =
      dataWorkspaceId === selectedWorkspace ? preference : null;
    if (!selectedWorkspace || !online || !visiblePreference) return false;
    const isCurrent = captureScope(selectedWorkspace);
    const mutationKey = `${scopeGeneration.current}:preferences`;
    if (!isCurrent() || mutations.current.has(mutationKey)) return false;
    mutations.current.add(mutationKey);
    const categories = new Set<NotificationCategory>(input.enabledCategories);
    for (const category of visiblePreference.enabled_categories) {
      if (!NOTIFICATION_CATEGORIES.some((visible) => visible === category))
        categories.add(category);
    }
    categories.add("security");
    try {
      const saved = await browserApiClient.request<SearchPreference>(
        `/api/v1/workspaces/${selectedWorkspace}/notification-preferences`,
        {
          body: JSON.stringify({
            enabled_categories: [...categories],
            expected_version: visiblePreference?.version || null,
            quiet_end_minute: input.quietEndMinute,
            quiet_start_minute: input.quietStartMinute,
            timezone: input.timezone,
          }),
          csrf: true,
          method: "PUT",
        },
      );
      if (!isCurrent()) return false;
      preferenceRevision.current += 1;
      setPreference(saved);
      announceNotificationWorkspace(selectedWorkspace, accountRef.current!);
      setIssue(null);
      setStatus("通知偏好已保存；安全通知始终保留。");
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setIssue({ ...issueFrom(error), utility: true });
      setStatus(errorText(error));
      return false;
    } finally {
      mutations.current.delete(mutationKey);
    }
  }

  async function markRead(notification: SearchNotification): Promise<boolean> {
    const selectedWorkspace = workspaceIdRef.current;
    if (
      !selectedWorkspace ||
      !online ||
      notification.workspace_id !== selectedWorkspace ||
      dataWorkspaceId !== selectedWorkspace ||
      !notifications.some((item) => item.id === notification.id)
    )
      return false;
    const isCurrent = captureScope(selectedWorkspace);
    const mutationKey = `${scopeGeneration.current}:read:${notification.id}`;
    if (!isCurrent() || mutations.current.has(mutationKey)) return false;
    mutations.current.add(mutationKey);
    try {
      const saved = await browserApiClient.request<SearchNotification>(
        `/api/v1/workspaces/${selectedWorkspace}/notifications/${notification.id}/read`,
        { body: JSON.stringify({ read: true }), csrf: true, method: "POST" },
      );
      if (!isCurrent()) return false;
      // Do not discard unrelated feed/space updates in an overlapping list load.
      notificationRevision.current += 1;
      setNotifications((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      announceNotificationWorkspace(selectedWorkspace, accountRef.current!);
      setIssue(null);
      setStatus("通知已标为已读。");
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setIssue({ ...issueFrom(error), utility: true });
      setStatus(errorText(error));
      return false;
    } finally {
      mutations.current.delete(mutationKey);
    }
  }

  async function createFeed(name: string): Promise<string | null> {
    const selectedWorkspace = workspaceIdRef.current;
    if (!selectedWorkspace || !online || !name.trim()) return null;
    const isCurrent = captureScope(selectedWorkspace);
    if (!isCurrent()) return null;
    try {
      const result = await integrationCapabilityService.createCalendarFeed(
        selectedWorkspace,
        { id: crypto.randomUUID(), name: name.trim() },
      );
      if (!isCurrent()) return null;
      const refreshed = await loadData(selectedWorkspace);
      if (!isCurrent()) return null;
      setStatus(
        refreshed
          ? "日历订阅已创建。请立即保存一次性 URL。"
          : "日历订阅已创建，但列表尚未刷新。请先保存一次性 URL，再重试读取。",
      );
      return result.token;
    } catch (error) {
      if (!isCurrent()) return null;
      setIssue({ ...issueFrom(error), utility: true });
      setStatus(errorText(error));
      return null;
    }
  }

  async function revokeFeed(feed: CalendarFeed): Promise<boolean> {
    const selectedWorkspace = workspaceIdRef.current;
    if (!selectedWorkspace || !online) return false;
    const isCurrent = captureScope(selectedWorkspace);
    if (!isCurrent()) return false;
    try {
      await integrationCapabilityService.revokeCalendarFeed(
        selectedWorkspace,
        feed.id,
        feed.version,
      );
      if (!isCurrent()) return false;
      setFeeds((current) =>
        current.map((item) =>
          item.id === feed.id ? { ...item, status: "revoked" } : item,
        ),
      );
      const refreshed = await loadData(selectedWorkspace);
      if (!isCurrent()) return false;
      setStatus(
        refreshed
          ? "日历订阅已撤销，原 URL 立即失效且无法恢复。"
          : "日历订阅已撤销，但列表尚未刷新，请重试读取。原 URL 已失效。",
      );
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setIssue({ ...issueFrom(error), utility: true });
      setStatus(errorText(error));
      return false;
    }
  }

  const visibleNotifications =
    dataWorkspaceId === workspaceId ? notifications : [];
  const visibleFeeds = dataWorkspaceId === workspaceId ? feeds : [];
  const visibleSpaces = dataWorkspaceId === workspaceId ? spaces : [];
  const visiblePreference = dataWorkspaceId === workspaceId ? preference : null;
  const filteredResults = useMemo(
    () => filterSearchResults(results, scope),
    [results, scope],
  );
  const groups = useMemo(
    () => groupSearchResults(filteredResults),
    [filteredResults],
  );
  const selectedResult =
    filteredResults.find((result) => result.object_id === selectedResultId) ??
    filteredResults[0] ??
    null;
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);

  let operationalKind: ProductOperationalStateKind | null = null;
  if (contextPhase === "loading" || searchPhase === "loading") {
    operationalKind = "loading";
  } else if (contextPhase === "error" || issue) {
    operationalKind = issue?.kind ?? "error";
  } else if (!workspaceId) {
    operationalKind = "empty";
  } else if (!online && !offlineUnlocked) {
    operationalKind = "locked";
  } else if (!online) {
    operationalKind = "stale";
  }

  const retry = () => {
    if (contextPhase === "error") {
      void loadWorkspaces();
    } else if (issue?.utility && workspaceIdRef.current) {
      void loadData(workspaceIdRef.current);
    } else if (lastInput.current) {
      void search(lastInput.current);
    } else if (workspaceIdRef.current) {
      void loadData(workspaceIdRef.current);
    }
  };
  const operationalState = operationalKind
    ? ({
        kind: operationalKind,
        recovery:
          operationalKind === "loading"
            ? {
                disabled: true,
                kind: "button",
                label: "正在读取",
                onInvoke: () => undefined,
              }
            : operationalKind === "empty"
              ? {
                  href: "/app/workspaces",
                  kind: "link",
                  label: "选择工作区",
                }
              : operationalKind === "locked"
                ? {
                    href: "#search-vault",
                    kind: "link",
                    label: "解锁本机缓存",
                  }
                : operationalKind === "permission"
                  ? {
                      href: "/app/workspaces",
                      kind: "link",
                      label: "查看成员权限",
                    }
                  : operationalKind === "capability-disabled"
                    ? {
                        href: "/app/integrations",
                        kind: "link",
                        label: "检查运行能力",
                      }
                    : operationalKind === "stale"
                      ? {
                          href: "/offline",
                          kind: "link",
                          label: "查看离线范围",
                        }
                      : {
                          kind: "button",
                          label:
                            operationalKind === "conflict"
                              ? "重新读取最新版本"
                              : "重试当前操作",
                          onInvoke: retry,
                        },
        requestId: issue?.requestId,
      } as ProductOperationalState)
    : null;

  const operational: WorkbenchOperationalContext = {
    permission: selectedWorkspace
      ? { label: selectedWorkspace.role, tone: "good" }
      : undefined,
    sync: {
      label: online
        ? "服务器权限过滤"
        : offlineUnlocked
          ? "本机缓存"
          : "离线受限",
      tone: online ? "good" : "warn",
    },
    vault: {
      label: offlineUnlocked ? "已解锁" : "已锁定",
      tone: offlineUnlocked ? "good" : "warn",
    },
    workspace: selectedWorkspace
      ? { id: selectedWorkspace.id, name: selectedWorkspace.name }
      : undefined,
  };

  return {
    capabilities: {
      canManageUtilities:
        Boolean(userId) &&
        online &&
        Boolean(workspaceId) &&
        dataWorkspaceId === workspaceId,
      canSearch: Boolean(workspaceId),
      canUnlock: session.status === "authenticated" && !offlineUnlocked,
    },
    commands: {
      createFeed,
      loadContext,
      markRead,
      resetSearch,
      revokeFeed,
      savePreferences,
      search,
      selectResult: setSelectedResultId,
      setWorkspaceId,
      unlock,
    },
    context: {
      offlineUnlocked,
      online,
      operational,
      operationalState,
      status,
      workspaceId,
      workspaces,
    },
    search: {
      groups,
      lastQuery,
      phase: searchPhase,
      resultCount: filteredResults.length,
      searched,
      selectedResult,
    },
    utilities: {
      activeFeedCount: visibleFeeds.filter((feed) => feed.status === "active")
        .length,
      feeds: visibleFeeds,
      notifications: visibleNotifications,
      preference: visiblePreference,
      spaces: visibleSpaces,
      unreadNotificationCount: visibleNotifications.filter(
        (notification) => notification.read_at === null,
      ).length,
    },
  };
}
