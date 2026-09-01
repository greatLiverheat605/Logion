"use client";

import type { components } from "@logion/contracts";
import {
  OfflineSearchRepository,
  type OfflineSearchResult,
} from "@logion/offline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  announceNotificationWorkspace,
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
  const [searchPhase, setSearchPhase] = useState<Phase>("idle");
  const [issue, setIssue] = useState<SearchIssue | null>(null);
  const [searched, setSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [selectedResultId, setSelectedResultId] = useState("");
  const [status, setStatus] = useState(
    "搜索不会把查询正文写入日志或第三方服务。",
  );
  const offlineUnlocked = vaultPhase === "unlocked";

  const loadWorkspaces = useCallback(async () => {
    setContextPhase("loading");
    try {
      const next = await integrationCapabilityService.listWorkspaces();
      setWorkspaces(next);
      setWorkspaceIdState((current) => {
        const resolved = next.some((item) => item.id === current)
          ? current
          : (next[0]?.id ?? "");
        workspaceIdRef.current = resolved;
        return resolved;
      });
      setContextPhase("ready");
      setIssue(null);
    } catch (error) {
      setContextPhase("error");
      setIssue(issueFrom(error));
      setStatus(errorText(error));
    }
  }, []);

  const loadData = useCallback(async (selected: string) => {
    const requestId = ++dataRequest.current;
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
      if (
        requestId !== dataRequest.current ||
        selected !== workspaceIdRef.current
      ) {
        return;
      }
      setNotifications(
        Array.isArray(notificationResult.notifications)
          ? filterVisibleNotifications(notificationResult.notifications)
          : [],
      );
      setPreference(preferenceResult);
      setFeeds(feedResult);
      setSpaces(spaceResult.spaces);
      setDataWorkspaceId(selected);
      setIssue(null);
    } catch (error) {
      if (
        requestId !== dataRequest.current ||
        selected !== workspaceIdRef.current
      ) {
        return;
      }
      setNotifications([]);
      setPreference(null);
      setFeeds([]);
      setSpaces([]);
      setDataWorkspaceId(selected);
      setIssue(issueFrom(error));
      setStatus(errorText(error));
    }
  }, []);

  const loadContext = useCallback(async () => {
    await loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (session.status === "authenticated") {
      queueMicrotask(() => void loadWorkspaces());
    }
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [loadWorkspaces, session.status]);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
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
    workspaceIdRef.current = nextWorkspaceId;
    searchRequest.current += 1;
    dataRequest.current += 1;
    lastInput.current = null;
    setWorkspaceIdState(nextWorkspaceId);
    setDataWorkspaceId("");
    setResults([]);
    setSelectedResultId("");
    setSearched(false);
    setSearchPhase("idle");
    setIssue(null);
    announceNotificationWorkspace(nextWorkspaceId);
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
    if (!selectedWorkspace || !online) return false;
    const categories = new Set<NotificationCategory>(input.enabledCategories);
    categories.add("security");
    try {
      await browserApiClient.request(
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
      await loadData(selectedWorkspace);
      announceNotificationWorkspace(selectedWorkspace);
      setIssue(null);
      setStatus("通知偏好已保存；安全通知始终保留。");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function markRead(notification: SearchNotification): Promise<boolean> {
    const selectedWorkspace = workspaceIdRef.current;
    if (!selectedWorkspace || !online) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selectedWorkspace}/notifications/${notification.id}/read`,
        { body: JSON.stringify({ read: true }), csrf: true, method: "POST" },
      );
      await loadData(selectedWorkspace);
      announceNotificationWorkspace(selectedWorkspace);
      setIssue(null);
      setStatus("通知已标为已读。");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function createFeed(name: string): Promise<string | null> {
    const selectedWorkspace = workspaceIdRef.current;
    if (!selectedWorkspace || !online || !name.trim()) return null;
    try {
      const result = await integrationCapabilityService.createCalendarFeed(
        selectedWorkspace,
        { id: crypto.randomUUID(), name: name.trim() },
      );
      await loadData(selectedWorkspace);
      setIssue(null);
      setStatus("日历订阅已创建。请立即保存一次性 URL。");
      return result.token;
    } catch (error) {
      setIssue(issueFrom(error));
      setStatus(errorText(error));
      return null;
    }
  }

  async function revokeFeed(feed: CalendarFeed): Promise<boolean> {
    const selectedWorkspace = workspaceIdRef.current;
    if (!selectedWorkspace || !online) return false;
    try {
      await integrationCapabilityService.revokeCalendarFeed(
        selectedWorkspace,
        feed.id,
        feed.version,
      );
      await loadData(selectedWorkspace);
      setIssue(null);
      setStatus("日历订阅已撤销，原 URL 立即失效且无法恢复。");
      return true;
    } catch (error) {
      setIssue(issueFrom(error));
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
      canManageUtilities: online && Boolean(workspaceId),
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
