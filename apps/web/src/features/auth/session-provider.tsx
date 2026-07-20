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
    createSessionCoordinator(createAuthApi(browserApiClient)),
  );
  const generation = useRef(0);
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(() => {
    const currentGeneration = ++generation.current;
    setState({ status: "loading" });
    void coordinator.refresh().then((nextState) => {
      if (generation.current === currentGeneration) setState(nextState);
    });
  }, [coordinator]);

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
