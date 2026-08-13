/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeGraphResponse } from "@/features/desk/knowledge-graph-api";

// Mock the API client so we control the request behavior without relying on
// globalThis.fetch capture timing.
const mockRequest = vi.fn();
vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request: (...args: unknown[]) => mockRequest(...args) },
  LogionApiError: class LogionApiError extends Error {
    readonly code: string;
    readonly requestId: string;
    readonly retryable: boolean;
    readonly status: number;
    constructor(input: {
      code: string;
      message: string;
      requestId?: string;
      retryable?: boolean;
      status: number;
    }) {
      super(input.message);
      this.name = "LogionApiError";
      this.code = input.code;
      this.requestId = input.requestId ?? "unavailable";
      this.retryable = input.retryable ?? false;
      this.status = input.status;
    }
  },
}));

import { useKnowledgeGraph } from "@/features/desk/use-knowledge-graph";
import { LogionApiError } from "@/lib/api/client";

const ROOT_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_ROOT_ID = "00000000-0000-4000-8000-000000000002";
const NODE_ID = "00000000-0000-4000-8000-000000000003";
const EDGE_ID = "00000000-0000-4000-8000-000000000101";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function makeGraphResponse(
  overrides: Partial<KnowledgeGraphResponse> = {},
): KnowledgeGraphResponse {
  return {
    depth: 1,
    edges: [],
    limits: { bytes: 1048576, edges: 400, nodes: 150 },
    next_cursor: null,
    nodes: [],
    root: { id: ROOT_ID, type: "topic" },
    truncated: false,
    truncation_reasons: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockRequest.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useKnowledgeGraph", () => {
  it("stays empty when inputs are missing (no request)", () => {
    const { result } = renderHook(() =>
      useKnowledgeGraph(null, null, null, null),
    );
    expect(result.current.state).toBe("empty");
    expect(result.current.data).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("fetches and maps a ready graph with nodes", async () => {
    mockRequest.mockResolvedValue(
      makeGraphResponse({
        nodes: [
          {
            excerpt_preview: null,
            id: ROOT_ID,
            label: "根知识点",
            type: "topic",
            version: 1,
          },
          {
            excerpt_preview: null,
            id: NODE_ID,
            label: "子知识点",
            type: "topic",
            version: 1,
          },
        ],
        edges: [
          {
            id: EDGE_ID,
            source: { id: ROOT_ID, type: "topic" },
            state: "accepted",
            target: { id: NODE_ID, type: "topic" },
            type: "topic_dependency" as const,
          },
        ],
      }),
    );

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1", { depth: 1 }),
    );

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.data?.nodes).toHaveLength(2);
    expect(result.current.data?.edges).toHaveLength(1);
    expect(result.current.meta?.truncated).toBe(false);
    expect(result.current.data?.nodes[0]?.tags).toContain("根节点");
  });

  it("maps empty nodes array to empty state", async () => {
    mockRequest.mockResolvedValue(makeGraphResponse());

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1"),
    );

    await waitFor(() => expect(result.current.data?.nodes).toEqual([]));
    expect(result.current.state).toBe("empty");
  });

  it("maps a 403 error to locked state (no existence leak)", async () => {
    mockRequest.mockRejectedValue(
      new LogionApiError({
        code: "FORBIDDEN",
        message: "no access",
        status: 403,
      }),
    );

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1"),
    );

    await waitFor(() => expect(result.current.state).toBe("locked"));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(LogionApiError);
  });

  it("maps a 500 error to error state", async () => {
    mockRequest.mockRejectedValue(
      new LogionApiError({
        code: "INTERNAL",
        message: "boom",
        status: 500,
      }),
    );

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1"),
    );

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error).toBeInstanceOf(LogionApiError);
  });

  it("maps a 404 to the same locked state as 403", async () => {
    mockRequest.mockRejectedValue(
      new LogionApiError({
        code: "NOT_FOUND",
        message: "not found",
        status: 404,
      }),
    );

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1"),
    );

    await waitFor(() => expect(result.current.state).toBe("locked"));
  });

  it("preserves truncation metadata from the response", async () => {
    mockRequest.mockResolvedValue(
      makeGraphResponse({
        nodes: [
          {
            excerpt_preview: null,
            id: ROOT_ID,
            label: "根",
            type: "topic",
            version: 1,
          },
        ],
        truncated: true,
        truncation_reasons: ["node_limit"],
        next_cursor: "next-page",
        depth: 2,
      }),
    );

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1", { depth: 2 }),
    );

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.meta?.truncated).toBe(true);
    expect(result.current.meta?.truncationReasons).toEqual(["node_limit"]);
    expect(result.current.meta?.nextCursor).toBe("next-page");
    expect(result.current.meta?.depth).toBe(2);
  });

  it("clamps depth to 2 even when requesting more", async () => {
    mockRequest.mockResolvedValue(makeGraphResponse());

    renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1", { depth: 5 }),
    );

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    const options = mockRequest.mock.calls[0]?.[1] as {
      query?: Record<string, string>;
    };
    expect(options?.query?.depth).toBe("2");
  });

  it("passes correct query parameters", async () => {
    mockRequest.mockResolvedValue(makeGraphResponse());

    renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1", {
        depth: 2,
        direction: "out",
        includeExcerptPreview: true,
      }),
    );

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    const options = mockRequest.mock.calls[0]?.[1] as {
      query?: Record<string, string>;
    };
    expect(options?.query).toEqual({
      root_type: "topic",
      root_id: "root-1",
      depth: "2",
      direction: "out",
      include_excerpt_preview: "true",
    });
  });

  it("omits include_excerpt_preview when false", async () => {
    mockRequest.mockResolvedValue(makeGraphResponse());

    renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", "root-1", {
        includeExcerptPreview: false,
      }),
    );

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    const options = mockRequest.mock.calls[0]?.[1] as {
      query?: Record<string, string>;
    };
    expect(options?.query?.include_excerpt_preview).toBeUndefined();
  });

  it("starts a new request immediately and ignores a stale old response", async () => {
    const first = deferred<KnowledgeGraphResponse>();
    mockRequest
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(
        makeGraphResponse({
          root: { id: SECOND_ROOT_ID, type: "topic" },
          nodes: [
            {
              excerpt_preview: null,
              id: SECOND_ROOT_ID,
              label: "新根节点",
              type: "topic",
              version: 1,
            },
          ],
        }),
      );

    const { result, rerender } = renderHook(
      ({ rootId }) => useKnowledgeGraph("ws-1", "sp-1", "topic", rootId),
      { initialProps: { rootId: ROOT_ID } },
    );

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    const firstSignal = (
      mockRequest.mock.calls[0]?.[1] as { signal?: AbortSignal }
    ).signal;

    rerender({ rootId: SECOND_ROOT_ID });

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.data?.nodes[0]?.label).toBe("新根节点");

    await act(async () => {
      first.resolve(
        makeGraphResponse({
          nodes: [
            {
              excerpt_preview: null,
              id: ROOT_ID,
              label: "旧根节点",
              type: "topic",
              version: 1,
            },
          ],
        }),
      );
      await first.promise;
    });
    expect(result.current.data?.nodes[0]?.label).toBe("新根节点");
  });

  it("aborts the active request on unmount", async () => {
    const pending = deferred<KnowledgeGraphResponse>();
    mockRequest.mockImplementationOnce(() => pending.promise);

    const { unmount } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", ROOT_ID),
    );
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    const signal = (mockRequest.mock.calls[0]?.[1] as { signal?: AbortSignal })
      .signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("fails closed on an over-limit response", async () => {
    mockRequest.mockResolvedValue(
      makeGraphResponse({
        nodes: Array.from({ length: 151 }, (_, index) => ({
          excerpt_preview: null,
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          label: `节点 ${index + 1}`,
          type: "topic" as const,
          version: 1,
        })),
      }),
    );

    const { result } = renderHook(() =>
      useKnowledgeGraph("ws-1", "sp-1", "topic", ROOT_ID),
    );
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error?.code).toBe("WEB_GRAPH_RESPONSE_INVALID");
    expect(result.current.data).toBeNull();
  });

  it("encodes workspace and space ids as path segments", async () => {
    mockRequest.mockResolvedValue(makeGraphResponse());
    renderHook(() =>
      useKnowledgeGraph("ws/one", "space#one", "topic", ROOT_ID),
    );
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(mockRequest.mock.calls[0]?.[0]).toBe(
      "/api/v1/workspaces/ws%2Fone/spaces/space%23one/knowledge/graph",
    );
  });
});
