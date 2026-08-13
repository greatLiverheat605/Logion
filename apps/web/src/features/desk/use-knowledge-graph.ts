"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type GraphMeta,
  KnowledgeGraphResponseError,
  type KnowledgeTargetType,
  clampDepth,
  mapKnowledgeGraphResponse,
} from "@/features/desk/knowledge-graph-api";
import type { KnowledgeSpaceGraphState } from "@/features/knowledge-space-prototype/knowledge-space-graph";
import type { KsData } from "@/features/knowledge-space-prototype/ks-mock-data";
import { LogionApiError, browserApiClient } from "@/lib/api/client";

/* ---- Hook options -------------------------------------------------------- */

export interface UseKnowledgeGraphOptions {
  /** 1-hop or 2-hop bounded view. Clamped to 1|2; the client never expands. */
  depth?: number;
  /** `"out" | "in" | "both"`. Defaults to `"both"`. */
  direction?: "out" | "in" | "both";
  /** Whether to request excerpt previews (surfaces source evidence). */
  includeExcerptPreview?: boolean;
  /**
   * Opaque cursor from a previous response's `next_cursor`. Omit for the first
   * page. (Pagination load is a future batch; the cursor is accepted but only
   * the first page is fetched in I0-C1.)
   */
  cursor?: string | null;
}

export interface UseKnowledgeGraphResult {
  state: KnowledgeSpaceGraphState;
  data: KsData | null;
  meta: GraphMeta | null;
  error: LogionApiError | null;
  reload: () => void;
}

/* ---- State mapping ------------------------------------------------------- */

/**
 * A 403 or 404 maps to the same locked state so the UI cannot be used to
 * distinguish an inaccessible object from a missing object.
 */
function errorToState(error: LogionApiError): KnowledgeSpaceGraphState {
  if (error.status === 403 || error.status === 404) return "locked";
  return "error";
}

/* ---- Hook ---------------------------------------------------------------- */

/**
 * Fetches the server-authorised bounded knowledge graph for a given root
 * object in a Space. Uses the real contract endpoint
 * `GET /api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge/graph`.
 *
 * The hook enforces the bounded-view contract on the client side:
 *
 * - `depth` is clamped to 1 or 2 — the frontend never requests a wider scope.
 * - Only the first page is fetched in I0-C1; `next_cursor` is surfaced in
 *   `meta` so the UI can show "more data available" without silently dropping
 *   the truncation signal.
 * - Input changes abort the previous request and a monotonically increasing
 *   request id prevents an abort-ignoring executor from committing stale data.
 *
 * When `workspaceId`, `spaceId`, `rootType` or `rootId` is empty, the hook
 * stays idle (state `"empty"`) without making a request.
 */
export function useKnowledgeGraph(
  workspaceId: string | null,
  spaceId: string | null,
  rootType: KnowledgeTargetType | null,
  rootId: string | null,
  options: UseKnowledgeGraphOptions = {},
): UseKnowledgeGraphResult {
  const {
    cursor = null,
    depth = 1,
    direction = "both",
    includeExcerptPreview = true,
  } = options;

  const [state, setState] = useState<KnowledgeSpaceGraphState>("empty");
  const [data, setData] = useState<KsData | null>(null);
  const [meta, setMeta] = useState<GraphMeta | null>(null);
  const [error, setError] = useState<LogionApiError | null>(null);

  const activeControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;

    if (!workspaceId || !spaceId || !rootType || !rootId) {
      queueMicrotask(() => {
        if (requestIdRef.current !== requestId) return;
        setData(null);
        setMeta(null);
        setError(null);
        setState("empty");
      });
      return undefined;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    queueMicrotask(() => {
      if (requestIdRef.current !== requestId || controller.signal.aborted)
        return;
      setData(null);
      setMeta(null);
      setState("loading");
      setError(null);
    });

    const clampedDepth = clampDepth(depth);
    const query: Record<string, string> = {
      depth: String(clampedDepth),
      direction,
      root_id: rootId,
      root_type: rootType,
    };
    if (includeExcerptPreview) {
      query.include_excerpt_preview = "true";
    }
    if (cursor) {
      query.cursor = cursor;
    }

    const run = async () => {
      try {
        const response = await browserApiClient.request<unknown>(
          `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/spaces/${encodeURIComponent(spaceId)}/knowledge/graph`,
          { query, signal: controller.signal },
        );
        const { data: mappedData, meta: mappedMeta } =
          mapKnowledgeGraphResponse(response);
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }
        setData(mappedData);
        setMeta(mappedMeta);
        setState(mappedData.nodes.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }
        const apiError =
          err instanceof LogionApiError
            ? err
            : new LogionApiError({
                code:
                  err instanceof KnowledgeGraphResponseError
                    ? "WEB_GRAPH_RESPONSE_INVALID"
                    : "WEB_GRAPH_FETCH_FAILED",
                message: "The knowledge graph could not be loaded.",
                status: 0,
              });
        setError(apiError);
        setData(null);
        setMeta(null);
        setState(errorToState(apiError));
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    };

    void run();

    return () => {
      controller.abort();
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    };
  }, [
    cursor,
    depth,
    direction,
    includeExcerptPreview,
    rootId,
    rootType,
    reloadTick,
    spaceId,
    workspaceId,
  ]);

  const reload = useCallback(() => {
    setReloadTick((tick) => tick + 1);
  }, []);

  return { data, error, meta, reload, state };
}
