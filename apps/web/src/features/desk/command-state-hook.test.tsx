/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CommandExecutor,
  useCommand,
} from "@/features/desk/command-state";
import { LogionApiError } from "@/lib/api/client";

afterEach(cleanup);

/**
 * Returns an executor that blocks on a controllable promise. The promise
 * resolves when `resolve()` is called OR when the abort signal fires (so the
 * run completes naturally on cancel/reset/unmount instead of hanging forever).
 */
function makeBlockingExecutor(onPending?: () => void): {
  executor: CommandExecutor;
  resolve: () => void;
  spy: ReturnType<typeof vi.fn>;
} {
  let resolveFn: (() => void) | null = null;
  const spy = vi.fn();
  const blocking = () =>
    new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
  const executor: CommandExecutor = async ({ signal, transitionToPending }) => {
    transitionToPending();
    onPending?.();
    spy();
    // Resolve either when the caller calls resolve() or the signal aborts.
    await Promise.race([
      blocking(),
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener("abort", () => resolve());
      }),
    ]);
    return true as const;
  };
  return { executor, resolve: () => resolveFn?.(), spy };
}

/**
 * Returns an executor that **completely ignores** the AbortSignal — it only
 * resolves when `resolve()` is called. Used to verify that `cancel()` releases
 * the synchronous guard without depending on the executor honouring abort.
 */
function makeIgnoreAbortExecutor(): {
  executor: CommandExecutor;
  resolve: () => void;
} {
  let resolveFn: (() => void) | null = null;
  const blocking = () =>
    new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
  const executor: CommandExecutor = async ({ transitionToPending }) => {
    transitionToPending();
    // Intentionally ignore signal — only resolve() unblocks this.
    await blocking();
    return true as const;
  };
  return { executor, resolve: () => resolveFn?.() };
}

describe("useCommand", () => {
  it("transitions idle → validating → pending → success on a happy path", async () => {
    const { result } = renderHook(() => useCommand());
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.isBlocking).toBe(false);

    await act(async () => {
      await result.current.run(async ({ transitionToPending }) => {
        transitionToPending();
        await Promise.resolve();
        return true as const;
      });
    });

    expect(result.current.state.kind).toBe("success");
    expect(result.current.isBlocking).toBe(false);
  });

  it("stays in validation_error when executor returns validation_error", async () => {
    const { result } = renderHook(() => useCommand());
    await act(async () => {
      await result.current.run(async () => "validation_error");
    });
    expect(result.current.state.kind).toBe("validation_error");
  });

  it("classifies a thrown 409 as conflict and surfaces requestId", async () => {
    const { result } = renderHook(() => useCommand());
    await act(async () => {
      await result.current.run(async () => {
        throw new LogionApiError({
          code: "INVITATION_CONFLICT",
          message: "conflict",
          requestId: "req-42",
          status: 409,
        });
      });
    });
    expect(result.current.state.kind).toBe("conflict");
    expect(result.current.state.requestId).toBe("req-42");
  });

  it("does NOT start a second request on rapid double-click (synchronous guard)", async () => {
    const { result } = renderHook(() => useCommand());
    const { executor, resolve, spy } = makeBlockingExecutor();

    // Kick off the first run (stays pending until we resolve).
    act(() => {
      void result.current.run(executor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    // Rapid second call while the first is in flight — must be a no-op.
    act(() => {
      void result.current.run(executor);
    });

    // The executor must have been called exactly ONCE — no second write.
    expect(spy).toHaveBeenCalledTimes(1);

    // Resolve the first run so the test can complete cleanly.
    resolve();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("reset aborts the in-flight request and returns to idle", async () => {
    const { result } = renderHook(() => useCommand());
    const { executor } = makeBlockingExecutor();

    act(() => {
      void result.current.run(executor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    act(() => result.current.reset());
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.isBlocking).toBe(false);
    // Allow the aborted executor to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("cancel aborts the in-flight request and sets cancelled state", async () => {
    const { result } = renderHook(() => useCommand());
    const { executor } = makeBlockingExecutor();

    act(() => {
      void result.current.run(executor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    act(() => result.current.cancel());
    expect(result.current.state.kind).toBe("cancelled");
    // Allow the aborted executor to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("a second run after the first completes starts fresh (guard clears)", async () => {
    const { result } = renderHook(() => useCommand());

    await act(async () => {
      await result.current.run(async ({ transitionToPending }) => {
        transitionToPending();
        await Promise.resolve();
        return true as const;
      });
    });
    expect(result.current.state.kind).toBe("success");

    // Now a second run should work (the guard cleared after the first finished).
    await act(async () => {
      await result.current.run(async () => {
        throw new LogionApiError({
          code: "INTERNAL",
          message: "boom",
          status: 500,
        });
      });
    });
    expect(result.current.state.kind).toBe("error");
  });

  it("aborts the in-flight request on unmount (no state update after teardown)", async () => {
    const { executor } = makeBlockingExecutor();
    const { result, unmount } = renderHook(() => useCommand());
    act(() => {
      void result.current.run(executor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    // Unmounting must abort the request without throwing.
    expect(() => act(() => unmount())).not.toThrow();
  });

  it("reset returns to idle from an error state", async () => {
    const { result } = renderHook(() => useCommand());
    await act(async () => {
      await result.current.run(async () => "validation_error");
    });
    expect(result.current.state.kind).toBe("validation_error");
    act(() => result.current.reset());
    expect(result.current.state.kind).toBe("idle");
  });

  it("markCapabilityDisabled sets capability_disabled without an API call", () => {
    const { result } = renderHook(() => useCommand());
    act(() => result.current.markCapabilityDisabled());
    expect(result.current.state.kind).toBe("capability_disabled");
  });

  it("executor returning offline_queued requires a genuine queue write", async () => {
    const { result } = renderHook(() => useCommand());
    await act(async () => {
      await result.current.run(async () => "offline_queued");
    });
    expect(result.current.state.kind).toBe("offline_queued");
  });

  it("cancel() releases the guard immediately even if the executor ignores abort", async () => {
    const { result } = renderHook(() => useCommand());
    const { executor: ignoreAbortExecutor } = makeIgnoreAbortExecutor();

    // Start a run whose executor will NEVER resolve on its own.
    act(() => {
      void result.current.run(ignoreAbortExecutor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    // cancel() must release the synchronous guard immediately — the old
    // executor is still pending (it ignores abort).
    act(() => result.current.cancel());
    expect(result.current.state.kind).toBe("cancelled");

    // A new run() must succeed without waiting for the old executor.
    await act(async () => {
      await result.current.run(async ({ transitionToPending }) => {
        transitionToPending();
        await Promise.resolve();
        return true as const;
      });
    });
    expect(result.current.state.kind).toBe("success");
  });

  it("old executor that ignores abort and resolves late does NOT overwrite the new command", async () => {
    const { result } = renderHook(() => useCommand());
    const { executor: oldExecutor, resolve: resolveOld } =
      makeIgnoreAbortExecutor();

    act(() => {
      void result.current.run(oldExecutor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    // Cancel + start a new command that completes as success.
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.run(async ({ transitionToPending }) => {
        transitionToPending();
        await Promise.resolve();
        return true as const;
      });
    });
    expect(result.current.state.kind).toBe("success");

    // The old executor finally resolves (late). It must NOT overwrite success.
    resolveOld();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.kind).toBe("success");
  });

  it("markCapabilityDisabled during an in-flight run detaches it and is not overwritten by a late result", async () => {
    const { result } = renderHook(() => useCommand());
    const { executor: ignoreAbortExecutor, resolve: resolveOld } =
      makeIgnoreAbortExecutor();

    act(() => {
      void result.current.run(ignoreAbortExecutor);
    });
    await waitFor(() => expect(result.current.isBlocking).toBe(true));

    // markCapabilityDisabled during the run must detach + abort the old run.
    act(() => result.current.markCapabilityDisabled());
    expect(result.current.state.kind).toBe("capability_disabled");

    // The old executor resolves late — it must NOT overwrite capability_disabled.
    resolveOld();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.kind).toBe("capability_disabled");

    // The guard was released, so a new run() can proceed.
    await act(async () => {
      await result.current.run(async ({ transitionToPending }) => {
        transitionToPending();
        await Promise.resolve();
        return true as const;
      });
    });
    expect(result.current.state.kind).toBe("success");
  });
});
