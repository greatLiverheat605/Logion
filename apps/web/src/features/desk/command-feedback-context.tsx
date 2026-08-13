"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  DeskConflictResolver,
  DeskToast,
  type DeskToastTone,
} from "@/components/desk/desk-feedback";

/* ---- Toast model --------------------------------------------------------- */

export interface ToastInput {
  title: string;
  detail?: string;
  tone: DeskToastTone;
  /** Optional inline action shown on the toast (e.g. "查看对象"). */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after this many ms. Omit for manual-dismiss. */
  durationMs?: number;
}

interface ToastEntry extends ToastInput {
  id: number;
}

/* ---- Conflict resolver model -------------------------------------------- */

export interface ConflictRequest {
  title?: string;
  detail: string;
  actions: ReadonlyArray<{
    kind: "reload" | "merge" | "keep_copy" | "cancel";
    label: string;
    onClick: () => void;
  }>;
  requestId?: string;
}

/* ---- Inspector model ---------------------------------------------------- */

export interface InspectorContent {
  title: string;
  body: ReactNode;
}

/* ---- Context ------------------------------------------------------------ */

interface CommandFeedbackContextValue {
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: number) => void;
  /** Currently open conflict resolver request, if any. */
  conflict: (ConflictRequest & { id: number }) | null;
  requestConflictResolution: (request: ConflictRequest) => void;
  dismissConflict: () => void;
  /** Inspector slot content, if open. */
  inspector: InspectorContent | null;
  openInspector: (content: InspectorContent) => void;
  closeInspector: () => void;
}

const CommandFeedbackContext =
  createContext<CommandFeedbackContextValue | null>(null);

const DEFAULT_DURATION_MS = 4_000;

// SSR-safe portal detection (mirrors the pattern in AppOperationalTools):
// `useSyncExternalStore` returns false during SSR and true on the client, so
// the toast portal only renders after hydration without a setState-in-effect.
const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Provides three D2 global feedback surfaces:
 *
 * 1. **Toast host** — ephemeral confirmations rendered into a portal at the
 *    bottom-right. Success toasts are a *secondary* signal only; the primary
 *    confirmation always lives next to the trigger (D2 §02).
 * 2. **Conflict resolver** — a pending 409 request awaiting the caller's
 *    resolution actions.
 * 3. **Inspector slot** — right-pane content for graph/evidence/detail views.
 *
 * Mount this provider inside `VaultSessionProvider` and outside `AppShell`.
 */
export function CommandFeedbackProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [conflict, setConflict] = useState<
    (ConflictRequest & { id: number }) | null
  >(null);
  const [inspector, setInspector] = useState<InspectorContent | null>(null);
  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );
  const nextId = useRef(1);
  // Pending toast auto-dismiss timers, keyed by toast id. Cleared on unmount
  // and when a toast is dismissed early so no timer fires after teardown.
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // On unmount, clear every pending timer so a toast never mutates state on an
  // unmounted provider.
  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      for (const handle of timerMap.values()) clearTimeout(handle);
      timerMap.clear();
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
    // `bad` toasts never auto-dismiss — they require manual acknowledgement
    // so a failure is never silently dropped. Non-bad toasts auto-dismiss
    // after the configured duration (including under reduced-motion; the
    // reduced-motion setting only suppresses animations, not the dismiss
    // timer). An explicit durationMs <= 0 opts out of auto-dismiss entirely.
    const autoDismiss =
      toast.tone !== "bad" && (toast.durationMs ?? DEFAULT_DURATION_MS) > 0;
    if (autoDismiss) {
      const duration = toast.durationMs ?? DEFAULT_DURATION_MS;
      const handle = setTimeout(() => {
        timers.current.delete(id);
        setToasts((current) => current.filter((entry) => entry.id !== id));
      }, duration);
      timers.current.set(id, handle);
    }
  }, []);

  const requestConflictResolution = useCallback((request: ConflictRequest) => {
    const id = nextId.current++;
    setConflict({ ...request, id });
  }, []);

  const dismissConflict = useCallback(() => setConflict(null), []);

  const openInspector = useCallback((content: InspectorContent) => {
    setInspector(content);
  }, []);

  const closeInspector = useCallback(() => setInspector(null), []);

  const value = useMemo<CommandFeedbackContextValue>(
    () => ({
      closeInspector,
      conflict,
      dismissConflict,
      dismissToast,
      inspector,
      openInspector,
      requestConflictResolution,
      showToast,
    }),
    [
      closeInspector,
      conflict,
      dismissConflict,
      dismissToast,
      inspector,
      openInspector,
      requestConflictResolution,
      showToast,
    ],
  );

  return (
    <CommandFeedbackContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <>
              <div aria-live="polite" className="desk-toast-region">
                {toasts.map((toast) => (
                  <DeskToast
                    action={toast.action}
                    detail={toast.detail}
                    key={toast.id}
                    onClose={() => dismissToast(toast.id)}
                    title={toast.title}
                    tone={toast.tone}
                  />
                ))}
              </div>
              {conflict ? (
                <div aria-live="polite" className="desk-conflict-region">
                  <DeskConflictResolver
                    actions={conflict.actions.map((action) => ({
                      ...action,
                      onClick: () => {
                        action.onClick();
                        dismissConflict();
                      },
                    }))}
                    detail={conflict.detail}
                    error={undefined}
                    key={conflict.id}
                    requestId={conflict.requestId}
                    title={conflict.title}
                  />
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </CommandFeedbackContext.Provider>
  );
}

/**
 * Access the D2 feedback surfaces. Must be called inside a
 * {@link CommandFeedbackProvider}. Throws if used outside the provider so
 * missing wiring fails loudly instead of silently dropping feedback.
 */
export function useCommandFeedback(): CommandFeedbackContextValue {
  const ctx = useContext(CommandFeedbackContext);
  if (!ctx) {
    throw new Error(
      "useCommandFeedback must be used inside <CommandFeedbackProvider>.",
    );
  }
  return ctx;
}

/**
 * Convenience hook for the Inspector slot. Returns the current inspector
 * content and open/close controls. Used by AppShell to render the right pane.
 */
export function useInspector() {
  const { closeInspector, inspector, openInspector } = useCommandFeedback();
  return { closeInspector, inspector, openInspector };
}
