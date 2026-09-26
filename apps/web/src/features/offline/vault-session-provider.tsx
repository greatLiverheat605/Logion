"use client";

import {
  databaseNameForUser,
  OfflineVault,
  openOfflineDatabase,
  type LogionOfflineDatabase,
} from "@logion/offline";
import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/features/auth/session-provider";

export type VaultSessionPhase =
  | "clearing"
  | "locked"
  | "unlocking"
  | "unlocked";

export const VAULT_SESSION_DURATION_MS = 30 * 60 * 1000;

interface VaultSessionContextValue {
  expiresAt: number | null;
  activeDatabase: LogionOfflineDatabase | null;
  activeVault: OfflineVault | null;
  database: MutableRefObject<LogionOfflineDatabase | null>;
  phase: VaultSessionPhase;
  revision: number;
  vault: MutableRefObject<OfflineVault | null>;
  clearLocalData: () => Promise<void>;
  lock: () => void;
  markChanged: () => void;
  unlock: (passphrase: string) => Promise<{
    database: LogionOfflineDatabase;
    initialized: boolean;
    vault: OfflineVault;
  }>;
}

const VaultSessionContext = createContext<VaultSessionContextValue | null>(
  null,
);

export function VaultSessionProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { state: session } = useSession();
  const database = useRef<LogionOfflineDatabase | null>(null);
  const vault = useRef<OfflineVault | null>(null);
  const userId = useRef<string | null>(null);
  const [activeDatabase, setActiveDatabase] =
    useState<LogionOfflineDatabase | null>(null);
  const [activeVault, setActiveVault] = useState<OfflineVault | null>(null);
  const [phase, setPhase] = useState<VaultSessionPhase>("locked");
  const [revision, setRevision] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const unlockAttempt = useRef(0);

  const lock = useCallback(() => {
    unlockAttempt.current += 1;
    setExpiresAt(null);
    vault.current?.lock();
    database.current?.close();
    vault.current = null;
    database.current = null;
    userId.current = null;
    setActiveDatabase(null);
    setActiveVault(null);
    setPhase("locked");
  }, []);

  const markChanged = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const clearLocalData = useCallback(async () => {
    if (session.status !== "authenticated") {
      throw new Error("not authenticated");
    }

    unlockAttempt.current += 1;
    setExpiresAt(null);
    setPhase("clearing");
    const authenticatedUserId = session.user.id;
    let targetDatabase =
      userId.current === authenticatedUserId ? database.current : null;
    try {
      if (targetDatabase === null) {
        targetDatabase = await openOfflineDatabase({
          databaseName: databaseNameForUser(authenticatedUserId),
          indexedDB: globalThis.indexedDB ?? null,
          IDBKeyRange: globalThis.IDBKeyRange ?? null,
        });
      }
      vault.current?.lock();
      await new OfflineVault(targetDatabase).wipeLocalData();
    } finally {
      vault.current?.lock();
      targetDatabase?.close();
      vault.current = null;
      database.current = null;
      userId.current = null;
      setActiveDatabase(null);
      setActiveVault(null);
      setPhase("locked");
      setRevision((current) => current + 1);
    }
  }, [session]);

  const unlock = useCallback(
    async (passphrase: string) => {
      if (session.status !== "authenticated") {
        throw new Error("not authenticated");
      }
      const attempt = ++unlockAttempt.current;
      userId.current = session.user.id;
      const previousPhase = phase;
      setPhase("unlocking");
      let nextDatabase: LogionOfflineDatabase | null = null;
      let nextVault: OfflineVault | null = null;
      try {
        nextDatabase = await openOfflineDatabase({
          databaseName: databaseNameForUser(session.user.id),
          indexedDB: globalThis.indexedDB ?? null,
          IDBKeyRange: globalThis.IDBKeyRange ?? null,
        });
        nextVault = new OfflineVault(nextDatabase);
        const initialized =
          (await nextDatabase.vaultMetadata.get(session.user.id)) === undefined;
        if (initialized) {
          await nextVault.initialize(session.user.id, passphrase);
        } else {
          await nextVault.unlock(session.user.id, passphrase);
        }
        if (attempt !== unlockAttempt.current)
          throw new Error("本次解锁已取消，请重新解锁。");
        vault.current?.lock();
        database.current?.close();
        database.current = nextDatabase;
        vault.current = nextVault;
        userId.current = session.user.id;
        setActiveDatabase(nextDatabase);
        setActiveVault(nextVault);
        setExpiresAt(Date.now() + VAULT_SESSION_DURATION_MS);
        setPhase("unlocked");
        setRevision((current) => current + 1);
        return { database: nextDatabase, initialized, vault: nextVault };
      } catch (error) {
        nextVault?.lock();
        nextDatabase?.close();
        if (attempt === unlockAttempt.current)
          setPhase(previousPhase === "unlocked" ? "unlocked" : "locked");
        throw error;
      }
    },
    [phase, session],
  );

  useEffect(() => {
    const authenticatedUserId =
      session.status === "authenticated" ? session.user.id : null;
    if (userId.current !== null && userId.current !== authenticatedUserId) {
      lock();
    }
  }, [lock, session]);

  useEffect(() => {
    if (expiresAt === null) return;
    const check = () => {
      if (Date.now() >= expiresAt) lock();
    };
    const timer = window.setInterval(check, 1000);
    const resume = () => {
      check();
      if (Date.now() < expiresAt && document.visibilityState === "visible")
        markChanged();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [expiresAt, lock, markChanged]);

  useEffect(() => lock, [lock]);

  const value = useMemo<VaultSessionContextValue>(
    () => ({
      expiresAt,
      activeDatabase,
      activeVault,
      clearLocalData,
      database,
      lock,
      markChanged,
      phase,
      revision,
      unlock,
      vault,
    }),
    [
      expiresAt,
      activeDatabase,
      activeVault,
      clearLocalData,
      lock,
      markChanged,
      phase,
      revision,
      unlock,
    ],
  );

  return (
    <VaultSessionContext.Provider value={value}>
      {children}
    </VaultSessionContext.Provider>
  );
}

export function useVaultSession(): VaultSessionContextValue {
  const value = useContext(VaultSessionContext);
  if (value === null) {
    throw new Error("useVaultSession must be used inside VaultSessionProvider");
  }
  return value;
}

/** For optional features such as form drafts: null outside the provider. */
export function useOptionalVaultSession(): VaultSessionContextValue | null {
  return useContext(VaultSessionContext);
}
