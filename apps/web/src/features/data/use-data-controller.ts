"use client";

import { secureRandomUuid } from "@logion/offline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { offlineCapabilityMessage } from "@/features/offline/offline-error-message";
import { integrationCapabilityService } from "@/features/integrations/integration-capability-service";
import type {
  DataExport,
  DataImport,
  Space,
  Workspace,
} from "@/features/integrations/integration-capability-model";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

export type DataTab = "exports" | "imports";
export type DataSelection = { kind: DataTab; id: string } | null;
export type DataState =
  | "loading"
  | "empty"
  | "ready"
  | "offline"
  | "permission"
  | "recent-auth"
  | "conflict"
  | "error";

export interface DataCapabilities {
  canExport: boolean;
  canImport: boolean;
  canDeleteAccount: boolean;
}

export interface DataControllerResult {
  capabilities: DataCapabilities;
  context: {
    dataState: DataState;
    imports: DataImport[];
    lastLoadedAt: string | null;
    selectedImport: DataImport | null;
    selectedExport: DataExport | null;
    selectedSpace: Space | null;
    selectedWorkspace: Workspace | null;
    spaces: Space[];
    status: string;
    tab: DataTab;
    workspaces: Workspace[];
    exports: DataExport[];
  };
  commands: {
    cancelExport: (item: DataExport) => Promise<boolean>;
    commitImport: (item: DataImport, spaceId: string) => Promise<boolean>;
    createExport: (confirmation: string) => Promise<boolean>;
    load: () => Promise<boolean>;
    previewImport: (input: {
      content: string;
      source_filename: string;
      source_format: DataImport["source_format"];
    }) => Promise<boolean>;
    requestAccountDeletion: (confirmation: string) => Promise<boolean>;
    selectImport: (id: string) => void;
    selectExport: (id: string) => void;
    selectTab: (tab: DataTab) => void;
    selectWorkspace: (id: string) => void;
  };
  loading: boolean;
}

function messageFor(error: unknown): { state: DataState; message: string } {
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null)
    return { state: "offline", message: capabilityMessage };
  if (error instanceof LogionApiError) {
    if (error.code === "AUTH_RECENT_LOGIN_REQUIRED") {
      return {
        state: "recent-auth",
        message: "此操作需要近期重新登录；数据不会被写入。",
      };
    }
    if (error.status === 403) {
      return {
        state: "permission",
        message: `当前 Workspace 权限不足（请求编号：${error.requestId}）。`,
      };
    }
    if (error.status === 409) {
      return {
        state: "conflict",
        message: `数据版本已变化，请刷新后重试（请求编号：${error.requestId}）。`,
      };
    }
    return {
      state: "error",
      message: `操作未完成（${error.code}，请求编号：${error.requestId}）。`,
    };
  }
  return { state: "error", message: "操作未完成；请检查网络后重试。" };
}

export function useDataController(): DataControllerResult {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [exports, setExports] = useState<DataExport[]>([]);
  const [imports, setImports] = useState<DataImport[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [targetSpaceId, setTargetSpaceId] = useState("");
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [tab, setTab] = useState<DataTab>("exports");
  const [selection, setSelection] = useState<DataSelection>(null);
  const [dataState, setDataState] = useState<DataState>("loading");
  const [status, setStatus] = useState("正在读取 Workspace 数据边界…");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [networkOffline, setNetworkOffline] = useState(false);
  const initialLoadStarted = useRef(false);

  const loadData = useCallback(async (selectedWorkspaceId: string) => {
    setLoading(true);
    try {
      const result = await integrationCapabilityService.loadPortability(
        selectedWorkspaceId,
      );
      setExports(result.exports);
      setImports(result.imports);
      setSpaces(result.privateSpaces);
      setTargetSpaceId((current) =>
        result.privateSpaces.some((space) => space.id === current)
          ? current
          : (result.privateSpaces[0]?.id ?? ""),
      );
      setDataWorkspaceId(selectedWorkspaceId);
      setSelection((current) => {
        if (current?.kind === "exports" && result.exports.some((item) => item.id === current.id)) return current;
        if (current?.kind === "imports" && result.imports.some((item) => item.id === current.id)) return current;
        const first = result.exports[0] ?? result.imports[0];
        return first ? { kind: result.exports.length ? "exports" : "imports", id: first.id } : null;
      });
      setDataState(result.exports.length || result.imports.length ? "ready" : "empty");
      setLastLoadedAt(new Date().toISOString());
      setStatus("数据边界已读取；导出和导入都需要显式确认。");
      return true;
    } catch (error) {
      setExports([]);
      setImports([]);
      setSpaces([]);
      setDataWorkspaceId(selectedWorkspaceId);
      const failure = messageFor(error);
      setDataState(failure.state);
      setStatus(failure.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await integrationCapabilityService.listWorkspaces();
      setWorkspaces(next);
      const selected = next.find((item) => item.id === workspaceId)?.id ?? next[0]?.id ?? "";
      setWorkspaceId(selected);
      if (!selected) {
        setDataState("empty");
        setStatus("当前账号没有可访问的 Workspace。");
        return false;
      }
      return await loadData(selected);
    } catch (error) {
      const failure = messageFor(error);
      setDataState(failure.state);
      setStatus(failure.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadData, workspaceId]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateNetworkState = () => setNetworkOffline(!window.navigator.onLine);
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  const runMutation = useCallback(
    async (operation: () => Promise<unknown>, successMessage: string) => {
      setLoading(true);
      try {
        await operation();
        const refreshed = workspaceId ? await loadData(workspaceId) : true;
        setStatus(
          refreshed
            ? successMessage
            : `${successMessage} 列表刷新未完成，请重试读取。`,
        );
        return true;
      } catch (error) {
        const failure = messageFor(error);
        setDataState(failure.state);
        setStatus(failure.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [loadData, workspaceId],
  );

  const commands = useMemo<DataControllerResult["commands"]>(() => ({
    cancelExport: (item) => runMutation(
      () => integrationCapabilityService.cancelExport(workspaceId, item.id, item.version),
      "导出任务已取消；未完成的产物不会保留。",
    ),
    commitImport: (item, spaceId) => runMutation(
      () => integrationCapabilityService.commitImport(workspaceId, item.id, {
        expected_version: item.version,
        target_space_id: spaceId,
      }),
      "导入已在单个事务中完成；所有对象均使用新 ID。",
    ),
    createExport: (confirmation) => runMutation(
      () => integrationCapabilityService.createExport(workspaceId, {
        confirmation,
        id: secureRandomUuid(),
      }),
      "导出已进入后台队列；完成后会出现在列表中。",
    ),
    load,
    previewImport: (input) => runMutation(
      () => integrationCapabilityService.previewImport(workspaceId, {
        ...input,
        id: secureRandomUuid(),
      }),
      "导入源已安全解析；请检查计数和警告后再确认写入。",
    ),
    requestAccountDeletion: (confirmation) => runMutation(
      () => browserApiClient.request("/api/v1/account-deletion", {
        body: JSON.stringify({ confirmation }),
        csrf: true,
        method: "POST",
      }),
      "删除请求已提交；正在前往可恢复的删除状态页。",
    ),
    selectImport: (id) => {
      setTab("imports");
      setSelection({ kind: "imports", id });
    },
    selectExport: (id) => {
      setTab("exports");
      setSelection({ kind: "exports", id });
    },
    selectTab: (nextTab) => {
      setTab(nextTab);
      setSelection((current) => {
        if (current?.kind === nextTab) return current;
        const first = nextTab === "exports" ? exports[0] : imports[0];
        return first ? { kind: nextTab, id: first.id } : null;
      });
    },
    selectWorkspace: (id) => {
      setWorkspaceId(id);
      void loadData(id);
    },
  }), [exports, imports, load, loadData, runMutation, workspaceId]);

  const visibleExports = dataWorkspaceId === workspaceId ? exports : [];
  const visibleImports = dataWorkspaceId === workspaceId ? imports : [];
  const selectedExport = selection?.kind === "exports" ? visibleExports.find((item) => item.id === selection.id) ?? null : null;
  const selectedImport = selection?.kind === "imports" ? visibleImports.find((item) => item.id === selection.id) ?? null : null;
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId) ?? null;
  const selectedSpace = spaces.find((item) => item.id === targetSpaceId) ?? null;
  const effectiveDataState = networkOffline ? "offline" : dataState;
  const effectiveStatus = networkOffline
    ? "当前设备处于离线状态；连接恢复后可以重新读取数据边界。"
    : status;
  const mutationBlocked = networkOffline
    || dataState === "loading"
    || dataState === "offline"
    || dataState === "permission"
    || dataState === "recent-auth"
    || dataState === "conflict"
    || dataState === "error";

  return {
    capabilities: {
      canDeleteAccount: !mutationBlocked,
      canExport: Boolean(selectedWorkspace) && !mutationBlocked,
      canImport: Boolean(selectedWorkspace && selectedSpace) && !mutationBlocked,
    },
    commands,
    context: {
      dataState: effectiveDataState,
      exports: visibleExports,
      imports: visibleImports,
      lastLoadedAt,
      selectedExport,
      selectedImport,
      selectedSpace,
      selectedWorkspace,
      spaces,
      status: effectiveStatus,
      tab,
      workspaces,
    },
    loading,
  };
}
