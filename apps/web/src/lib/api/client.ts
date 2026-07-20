import type { components } from "@logion/contracts";

type ErrorResponse = components["schemas"]["ErrorResponse"];

const API_PATH = /^\/api\/v1(?:\/|$)/;
const DEFAULT_TIMEOUT_MS = 15_000;
const CSRF_COOKIE_NAME = "logion_csrf";
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "origin",
  "referer",
  "x-csrf-token",
]);

export class LogionApiError extends Error {
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
}

export interface ApiRequestOptions extends Omit<
  RequestInit,
  "cache" | "credentials" | "headers" | "signal"
> {
  csrf?: boolean;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClientOptions {
  cookieSource?: () => string;
  fetchImplementation?: typeof fetch;
}

export interface ApiClient {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.request_id === "string"
  );
}

function readCookie(name: string, source: string): string | null {
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function validatePath(path: string): void {
  if (!API_PATH.test(path) || path.includes("?") || path.includes("#")) {
    throw new LogionApiError({
      code: "WEB_API_PATH_INVALID",
      message: "The API request path is not allowed.",
      status: 0,
    });
  }
}

function prepareHeaders(
  options: ApiRequestOptions,
  cookieSource: () => string,
): Headers {
  const headers = new Headers(options.headers);
  for (const name of headers.keys()) {
    if (FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())) {
      throw new LogionApiError({
        code: "WEB_API_HEADER_INVALID",
        message: "The API request contains a forbidden header.",
        status: 0,
      });
    }
  }
  headers.set("Accept", "application/json");
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.csrf) {
    const token = readCookie(CSRF_COOKIE_NAME, cookieSource());
    if (token === null || token === "") {
      throw new LogionApiError({
        code: "WEB_CSRF_MISSING",
        message: "The browser session cannot authorize this request.",
        status: 403,
      });
    }
    headers.set("X-CSRF-Token", token);
  }
  return headers;
}

function timeoutSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  if (callerSignal?.aborted) onAbort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onAbort);
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new LogionApiError({
      code: "WEB_API_RESPONSE_INVALID",
      message: "The server returned an invalid response.",
      requestId: response.headers.get("x-request-id") ?? undefined,
      retryable: response.status >= 500,
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new LogionApiError({
      code: "WEB_API_RESPONSE_INVALID",
      message: "The server returned an invalid response.",
      requestId: response.headers.get("x-request-id") ?? undefined,
      retryable: response.status >= 500,
      status: response.status,
    });
  }
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const cookieSource =
    options.cookieSource ?? (() => globalThis.document?.cookie ?? "");

  return {
    async request<T>(
      path: string,
      requestOptions: ApiRequestOptions = {},
    ): Promise<T> {
      validatePath(path);
      const timeoutMs = requestOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new LogionApiError({
          code: "WEB_API_TIMEOUT_INVALID",
          message: "The API timeout is invalid.",
          status: 0,
        });
      }
      const headers = prepareHeaders(requestOptions, cookieSource);
      const { cleanup, signal } = timeoutSignal(
        requestOptions.signal,
        timeoutMs,
      );
      const {
        csrf: _csrf,
        timeoutMs: _timeoutMs,
        ...fetchOptions
      } = requestOptions;
      void _csrf;
      void _timeoutMs;
      let response: Response;
      try {
        response = await fetchImplementation(path, {
          ...fetchOptions,
          cache: "no-store",
          credentials: "same-origin",
          headers,
          redirect: "error",
          signal,
        });
      } catch (error) {
        if (error instanceof LogionApiError) throw error;
        throw new LogionApiError({
          code: signal.aborted ? "WEB_API_ABORTED" : "WEB_NETWORK_UNAVAILABLE",
          message: signal.aborted
            ? "The request was cancelled or timed out."
            : "The server is currently unavailable.",
          retryable: true,
          status: 0,
        });
      } finally {
        cleanup();
      }

      if (response.status === 204) return undefined as T;
      const payload = await readJson(response);
      if (!response.ok) {
        if (isErrorResponse(payload)) {
          throw new LogionApiError({
            code: payload.code,
            message: payload.message,
            requestId: payload.request_id,
            retryable: payload.retryable,
            status: response.status,
          });
        }
        throw new LogionApiError({
          code: "WEB_API_RESPONSE_INVALID",
          message: "The server returned an invalid error response.",
          requestId: response.headers.get("x-request-id") ?? undefined,
          retryable: response.status >= 500,
          status: response.status,
        });
      }
      return payload as T;
    },
  };
}

export const browserApiClient = createApiClient();
