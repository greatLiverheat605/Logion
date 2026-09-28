"use client";

import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { components } from "@logion/contracts";
import { SessionProvider, useSession } from "@/features/auth/session-provider";
import {
  createWorkbenchQueryClient,
  errorMessage,
  workbenchRequest,
} from "./api";
import {
  DEFAULT_PREFERENCES,
  parsePreference,
  type Preferences,
  type WorkbenchContext,
} from "./preferences";

type Setting = components["schemas"]["UserSettingResponse"];
type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
interface WorkbenchState {
  preferences: Preferences;
  context: WorkbenchContext | null;
  workspaces: Workspace[];
  spaces: Space[];
  pending: boolean;
  save: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => Promise<boolean>;
  selectWorkspace: (id: string) => Promise<void>;
  selectSpace: (id: string) => Promise<void>;
}
const Context = createContext<WorkbenchState | null>(null);
export const SETTINGS_QUERY = ["workbench", "settings"] as const;
const spacesQuery = (workspace: string) => ({
  queryKey: ["workbench", "spaces", workspace],
  queryFn: () =>
    workbenchRequest<{ spaces: Space[] }>(
      `/api/v1/workspaces/${encodeURIComponent(workspace)}/spaces`,
    ),
});

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SessionGate>{children}</SessionGate>
    </SessionProvider>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const redirect = () => {
      router.replace(`/auth/login?next=${encodeURIComponent(path)}`);
    };
    window.addEventListener("workbench:authentication-required", redirect);
    return () =>
      window.removeEventListener("workbench:authentication-required", redirect);
  }, [router, path]);
  useEffect(() => {
    if (state.status === "anonymous") {
      router.replace(`/auth/login?next=${encodeURIComponent(path)}`);
    } else if (
      state.status === "authenticated" &&
      state.user.status === "pending_deletion"
    ) {
      router.replace("/account/deletion");
    }
  }, [state, router, path]);
  if (state.status === "error")
    return (
      <main id="main-content" className="wb-scope wb-empty">
        <h1>需要联网</h1>
        <p>无法确认登录状态，请检查连接。</p>
        <button onClick={refresh}>重新连接</button>
      </main>
    );
  if (
    state.status !== "authenticated" ||
    state.user.status === "pending_deletion"
  )
    return (
      <main id="main-content" className="wb-scope wb-empty" role="status">
        正在确认登录状态…
      </main>
    );
  return <AccountQueries key={state.user.id}>{children}</AccountQueries>;
}
function AccountQueries({ children }: { children: ReactNode }) {
  const [client] = useState(createWorkbenchQueryClient);
  useEffect(() => {
    const clear = () => client.clear();
    window.addEventListener("workbench:authentication-required", clear);
    return () => {
      window.removeEventListener("workbench:authentication-required", clear);
      client.clear();
    };
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <PreferenceProvider>{children}</PreferenceProvider>
    </QueryClientProvider>
  );
}
function PreferenceProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: SETTINGS_QUERY,
    queryFn: () =>
      workbenchRequest<{ settings: Setting[] }>("/api/v1/users/me/settings"),
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
  const workspaces = useQuery({
    queryKey: ["workbench", "workspaces"],
    queryFn: () =>
      workbenchRequest<{ workspaces: Workspace[] }>("/api/v1/workspaces"),
  });
  const preferences = { ...DEFAULT_PREFERENCES };
  for (const setting of settings.data?.settings ?? []) {
    if (Object.hasOwn(DEFAULT_PREFERENCES, setting.key)) {
      Object.assign(preferences, {
        [setting.key]: parsePreference(
          setting.key as keyof Preferences,
          setting.value,
        ),
      });
    }
  }
  const available = workspaces.data?.workspaces ?? [];
  const savedContext = preferences["workbench.context"];
  const workspaceId =
    available.find((w) => w.id === savedContext?.workspace_id)?.id ??
    available[0]?.id ??
    "";
  const spaces = useQuery({
    ...spacesQuery(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const accessibleSpaces = spaces.data?.spaces ?? [];
  const spaceId =
    accessibleSpaces.find(
      (s) =>
        savedContext?.workspace_id === workspaceId &&
        s.id === savedContext.space_id,
    )?.id ?? accessibleSpaces[0]?.id;
  const context =
    workspaceId && spaceId
      ? { workspace_id: workspaceId, space_id: spaceId }
      : null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const theme = preferences["appearance.theme"];
  useEffect(() => {
    // Keep the authenticated server-rendered theme until preferences arrive.
    if (!settings.data) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, settings.data]);
  const [online, setOnline] = useState(true);
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

  async function save<K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ): Promise<boolean> {
    if (writing.current || !settings.data) return false;
    writing.current = true;
    setPending(true);
    setError(null);
    await client.cancelQueries({ queryKey: SETTINGS_QUERY });
    const current =
      client.getQueryData<{ settings: Setting[] }>(SETTINGS_QUERY)?.settings ??
      [];
    try {
      const result = await workbenchRequest<{ settings: Setting[] }>(
        "/api/v1/users/me/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            settings: [
              {
                key,
                value: JSON.stringify(value),
                version: current.find((item) => item.key === key)?.version ?? 0,
              },
            ],
          }),
        },
      );
      client.setQueryData<{ settings: Setting[] }>(
        SETTINGS_QUERY,
        (previous) => ({
          settings: [
            ...(previous?.settings ?? []).filter((item) => item.key !== key),
            ...result.settings,
          ],
        }),
      );
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      await client.invalidateQueries({ queryKey: SETTINGS_QUERY });
      return false;
    } finally {
      writing.current = false;
      setPending(false);
    }
  }
  async function selectWorkspace(id: string) {
    if (!available.some((workspace) => workspace.id === id)) return;
    try {
      const next = await client.fetchQuery(spacesQuery(id));
      if (!next.spaces[0]) {
        setError("这个工作区还没有可访问的空间，请先在工作区管理中创建。");
        return;
      }
      await save("workbench.context", {
        workspace_id: id,
        space_id: next.spaces[0].id,
      });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function selectSpace(id: string) {
    if (accessibleSpaces.some((space) => space.id === id))
      await save("workbench.context", {
        workspace_id: workspaceId,
        space_id: id,
      });
  }
  const loadError = settings.error ?? workspaces.error ?? spaces.error;
  if (loadError && (!settings.data || !workspaces.data))
    return (
      <main id="main-content" className="wb-scope wb-empty">
        <h1>暂时无法载入工作台</h1>
        <p role="alert">{errorMessage(loadError)}</p>
        <button
          onClick={() =>
            void client.invalidateQueries({ queryKey: ["workbench"] })
          }
        >
          重新载入
        </button>
      </main>
    );
  if (!settings.data || !workspaces.data)
    return (
      <main id="main-content" className="wb-scope wb-empty" role="status">
        正在载入工作台…
      </main>
    );
  return (
    <Context.Provider
      value={{
        preferences,
        context,
        workspaces: available,
        spaces: accessibleSpaces,
        pending,
        save,
        selectWorkspace,
        selectSpace,
      }}
    >
      <div className="wb-scope wb-root">
        {(!online || error || loadError) && (
          <div className="wb-notice" role="alert">
            {!online
              ? "需要联网。当前无法保存，请恢复连接后重试。"
              : (error ?? errorMessage(loadError))}
            <button
              onClick={() => {
                setError(null);
                void client.invalidateQueries({ queryKey: ["workbench"] });
              }}
            >
              重新载入
            </button>
          </div>
        )}
        {children}
      </div>
    </Context.Provider>
  );
}
export function useWorkbench() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkbenchProvider is required");
  return value;
}
