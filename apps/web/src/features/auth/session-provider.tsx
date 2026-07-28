"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { browserApiClient } from "@/lib/api/client";

import {
  createAuthApi,
  createSessionCoordinator,
  createWebLockRefreshCoordinator,
  sessionRefreshDelay,
  type SessionCoordinator,
  type SessionState,
} from "./session";

interface SessionContextValue {
  refresh: () => void;
  state: SessionState;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [coordinator] = useState<SessionCoordinator>(() =>
    createSessionCoordinator(
      createAuthApi(browserApiClient),
      createWebLockRefreshCoordinator(),
    ),
  );
  const generation = useRef(0);
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const runRefresh = useCallback(
    (showLoading: boolean) => {
      const currentGeneration = ++generation.current;
      if (showLoading) setState({ status: "loading" });
      void coordinator.refresh().then((nextState) => {
        if (generation.current === currentGeneration) setState(nextState);
      });
    },
    [coordinator],
  );

  const refresh = useCallback(() => {
    runRefresh(true);
  }, [runRefresh]);

  const sessionExpiresAt =
    state.status === "authenticated" ? state.sessionExpiresAt : null;

  useEffect(() => {
    if (sessionExpiresAt === null) return;
    const scheduleDelay = sessionRefreshDelay(sessionExpiresAt);
    if (scheduleDelay === null) return;

    const refreshIfDue = () => {
      if (sessionRefreshDelay(sessionExpiresAt) === 0) runRefresh(false);
    };
    const timer = window.setTimeout(() => runRefresh(false), scheduleDelay);
    document.addEventListener("visibilitychange", refreshIfDue);
    window.addEventListener("focus", refreshIfDue);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshIfDue);
      window.removeEventListener("focus", refreshIfDue);
    };
  }, [runRefresh, sessionExpiresAt]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    void coordinator.bootstrap().then((nextState) => {
      if (generation.current === currentGeneration) setState(nextState);
    });
    return () => {
      generation.current += 1;
    };
  }, [coordinator]);

  return (
    <SessionContext.Provider value={{ refresh, state }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}
