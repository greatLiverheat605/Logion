"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LogionApiError } from "@/lib/api/client";

/**
 * Unified command lifecycle for the D2 redesign.
 *
 * Every side-effecting command goes through the same state machine so feedback
 * is consistent across pages:
 *
 * ```
 * idle → validating → pending → success → idle
 * ```
 *
 * Branch (error) states derived from {@link LogionApiError}:
 *
 * | status / code          | kind                |
 * |------------------------|---------------------|
 * | 409                    | conflict            |
 * | 403                    | permission_denied   |
 * | 422                    | validation_error    |
 * | 0 (network)            | offline             |
 * | API abort / timeout    | error               |
 * | invalid path/header/timeout | error          |
 * | >=500                  | error               |
 * | other                  | error               |
 *
 * `cancelled` is NOT produced by `classifyCommandError`. A command is only
 * `cancelled` when the user invokes the controller's `cancel()` (detected via
 * `controller.signal.aborted`). An API-side abort (`WEB_API_ABORTED`) may come
 * from an internal timeout, not a user cancel — it must surface as `error` so
 * the UI can show a timeout/retry message.
 *
 * `offline_queued` is NEVER set by `classifyCommandError` — it is reserved for
 * callers that have genuinely written the work item to an Outbox/queue. The
 * hook cannot prove a queue write happened, so a network failure is `offline`,
 * not `offline_queued`.
 *
 * `capability_disabled` is only ever set explicitly by the caller (the hook
 * cannot infer it from an HTTP response). See {@link useCommand}.
 */
export type CommandStatusKind =
  | "idle"
  | "validating"
  | "pending"
  | "success"
  | "validation_error"
  | "conflict"
  | "permission_denied"
  | "capability_disabled"
  | "offline"
  | "offline_queued"
  | "cancelled"
  | "uncertain_external"
  | "error";

export interface CommandState {
  kind: CommandStatusKind;
  error: LogionApiError | null;
  /** Stable request id surfaced to the user for traceability. */
  requestId: string | null;
}

const IDLE_STATE: CommandState = {
  error: null,
  kind: "idle",
  requestId: null,
};

/**
 * Client-side error codes that represent a programmer/usage error (invalid
 * path, header, or timeout configuration). These are deterministic failures
 * that must surface as `error`, not be hidden as offline/queued.
 *
 * NOTE: `WEB_API_ABORTED` is intentionally NOT in this set. An abort may come
 * from an internal API timeout (not a user cancel) and must surface as `error`
 * so the UI can show a timeout/retry message. A genuine user cancel is detected
 * separately via `controller.signal.aborted` inside the run lifecycle, not via
 * error classification.
 */
const INVALID_REQUEST_CODES = new Set([
  "WEB_API_PATH_INVALID",
  "WEB_API_HEADER_INVALID",
  "WEB_API_TIMEOUT_INVALID",
]);

/**
 * Maps a thrown value to a {@link CommandState} error kind.
 *
 * This function NEVER returns `cancelled`. A command is only `cancelled` when
 * the user invokes the controller's `cancel()` (the run lifecycle checks
 * `controller.signal.aborted` to set that state). Classifying an API-thrown
 * abort as `cancelled` would incorrectly hide an internal API timeout.
 *
 * Classification rules (in priority order):
 *
 * 1. A `LogionApiError` with an invalid-request code → `error` (deterministic
 *    misuse, not transient).
 * 2. A `LogionApiError` with status 409 → `conflict`.
 * 3. A `LogionApiError` with status 403 → `permission_denied`.
 * 4. A `LogionApiError` with status 422 → `validation_error`.
 * 5. A `LogionApiError` with the network-unavailable code or status 0 →
 *    `offline` (NOT queued — the hook cannot prove a queue write).
 * 6. Any other `LogionApiError` (including `WEB_API_ABORTED` from an API
 *    timeout) → `error`.
 * 7. A non-`LogionApiError` thrown value → `error` (unknown throw, never
 *    queued — we have no proof it was enqueued).
 *
 * `offline_queued` is never produced here; the caller must set it explicitly
 * after a genuine queue write.
 */
export function classifyCommandError(error: unknown): CommandState {
  if (error instanceof LogionApiError) {
    const base: Omit<CommandState, "kind"> = {
      error,
      requestId: error.requestId,
    };
    if (INVALID_REQUEST_CODES.has(error.code))
      return { ...base, kind: "error" };
    if (error.status === 409) return { ...base, kind: "conflict" };
    if (error.status === 403) return { ...base, kind: "permission_denied" };
    if (error.status === 422) return { ...base, kind: "validation_error" };
    // Only the explicit network-unavailable code maps to `offline`. A generic
    // status-0 error (e.g. WEB_API_ABORTED from an API timeout) is NOT offline.
    if (error.code === "WEB_NETWORK_UNAVAILABLE") {
      return { ...base, kind: "offline" };
    }
    // Includes WEB_API_ABORTED (API timeout), >=500, status-0 with an unknown
    // code, and any other code.
    return { ...base, kind: "error" };
  }
  // Unknown throw — we have no proof it was enqueued, so it is a plain error.
  return {
    error: null,
    kind: "error",
    requestId: null,
  };
}

/**
 * Executor contract for {@link useCommand}.
 *
 * The executor runs the full command: client-side validation first, then the
 * network round-trip. It receives {@link transitionToPending} so it can mark
 * the moment local validation passed and the request is about to be sent —
 * that is the `validating → pending` boundary defined by D2 §1.
 *
 * - Return `"validation_error"` to report a failed client-side check (no API
 *   call). The command flips to `validation_error` and the executor should
 *   surface the field-level error itself.
 * - Call {@link transitionToPending} exactly once, after validation succeeds
 *   and just before the first `await` on the API.
 * - Throw {@link LogionApiError} (or any value) to surface a classified error
 *   from the network round-trip.
 * - Return `true` when the command reports success.
 * - Return `"capability_disabled"` to short-circuit without an API call.
 * - Return `"offline_queued"` ONLY after the executor has genuinely written
 *   the work item to an Outbox/queue. The hook trusts the caller here because
 *   only the caller knows whether a queue write actually happened.
 */
export type CommandExecutorResult =
  | "validation_error"
  | "capability_disabled"
  | "offline_queued"
  | true;

export interface CommandExecutorInput {
  /** Signal the executor can wire into its fetch call to allow cancellation. */
  signal: AbortSignal;
  /**
   * Marks the command as `pending` (network in-flight). Call this once local
   * validation has passed and just before the first `await` on the API.
   */
  transitionToPending: () => void;
}

export type CommandExecutor = (
  input: CommandExecutorInput,
) => Promise<CommandExecutorResult>;

export interface UseCommandResult {
  state: CommandState;
  /**
   * `true` while a request is in flight (`validating` or `pending`). Use this
   * to disable the trigger button and set `aria-busy`.
   */
  isBlocking: boolean;
  /**
   * Runs the executor through the unified lifecycle. Uses a **synchronous
   * in-flight guard**: if a command is already running the call resolves
   * immediately as a no-op — it does NOT abort the running request and does
   * NOT start a second write. This enforces the D2 "pending 禁止重复提交"
   * contract. Call {@link reset} or {@link cancel} to stop the current run
   * before starting a new one.
   */
  run: (executor: CommandExecutor) => Promise<void>;
  /** Resets the command back to `idle`, clearing any error/request id. Aborts any in-flight request. */
  reset: () => void;
  /**
   * Aborts the current in-flight request and sets the state to `cancelled`.
   * Safe to call when idle.
   */
  cancel: () => void;
  /** Explicitly mark the command as capability-disabled (no API call). */
  markCapabilityDisabled: () => void;
}

/**
 * Encapsulates the D2 unified command lifecycle for a single side-effecting
 * action. The caller owns the executor logic (validation, API call, success
 * handling); this hook owns the state transitions, double-submit protection,
 * request cancellation and error classification.
 */
export function useCommand(): UseCommandResult {
  const [state, setState] = useState<CommandState>(IDLE_STATE);
  // Synchronous in-flight guard. A plain ref is read/written synchronously, so
  // two `run()` calls in the same tick cannot both pass the guard — the second
  // is rejected before it can create a controller or call the executor.
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Track whether the component is still mounted so async resolutions never
  // call setState after unmount.
  const mountedRef = useRef(true);

  // Abort on unmount so a request started before unmount cannot leak or write
  // state to an unmounted component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightRef.current = false;
    };
  }, []);

  const run = useCallback(async (executor: CommandExecutor) => {
    // Synchronous double-submit protection: if a run is already in flight,
    // ignore the new call entirely. This does NOT abort the running request
    // and does NOT start a second write.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ error: null, kind: "validating", requestId: null });
    const transitionToPending = () => {
      // Only honour the transition while this run still owns the controller.
      if (controllerRef.current !== controller) return;
      if (!mountedRef.current) return;
      setState((current) =>
        current.kind === "validating"
          ? { ...current, kind: "pending" }
          : current,
      );
    };
    try {
      const result = await executor({
        signal: controller.signal,
        transitionToPending,
      });
      // If this run was superseded (controller no longer current) or the
      // component unmounted, discard the result so a stale run cannot
      // overwrite the current state.
      if (controllerRef.current !== controller) return;
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        setState({ error: null, kind: "cancelled", requestId: null });
        return;
      }
      if (result === "validation_error") {
        setState((current) =>
          current.kind === "validating"
            ? { ...current, kind: "validation_error" }
            : current,
        );
        return;
      }
      if (result === "capability_disabled") {
        setState({ error: null, kind: "capability_disabled", requestId: null });
        return;
      }
      if (result === "offline_queued") {
        setState({ error: null, kind: "offline_queued", requestId: null });
        return;
      }
      setState({ error: null, kind: "success", requestId: null });
    } catch (error) {
      if (controllerRef.current !== controller) return;
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        setState({ error: null, kind: "cancelled", requestId: null });
        return;
      }
      setState(classifyCommandError(error));
    } finally {
      // Only clear the guard if this run still owns the controller. If it was
      // superseded, the owning run manages cleanup.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        inFlightRef.current = false;
      }
    }
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightRef.current = false;
    if (mountedRef.current) setState(IDLE_STATE);
  }, []);

  const cancel = useCallback(() => {
    // Detach the current controller and release the synchronous in-flight
    // guard BEFORE aborting. This ensures the guard is freed immediately — even
    // if the executor completely ignores the AbortSignal, a subsequent `run()`
    // can start right away. The old controller's finally block will see
    // `controllerRef.current !== oldController` and skip all state writes, so a
    // late resolve/reject cannot overwrite the new command.
    const old = controllerRef.current;
    controllerRef.current = null;
    inFlightRef.current = false;
    old?.abort();
    if (mountedRef.current)
      setState({ error: null, kind: "cancelled", requestId: null });
  }, []);

  const markCapabilityDisabled = useCallback(() => {
    // If a command is in flight, detach and abort it first so a late
    // resolve/reject from the old executor cannot overwrite the
    // capability_disabled state. Same detach-then-abort ordering as `cancel()`.
    const old = controllerRef.current;
    controllerRef.current = null;
    inFlightRef.current = false;
    old?.abort();
    if (mountedRef.current) {
      setState({ error: null, kind: "capability_disabled", requestId: null });
    }
  }, []);

  return {
    cancel,
    // isBlocking derives from reactive state so the UI updates when the run
    // enters validating/pending. The synchronous in-flight guard (inFlightRef)
    // is checked inside `run` to reject re-entrant calls in the same tick,
    // before the state update has flushed.
    isBlocking: state.kind === "validating" || state.kind === "pending",
    markCapabilityDisabled,
    reset,
    run,
    state,
  };
}
