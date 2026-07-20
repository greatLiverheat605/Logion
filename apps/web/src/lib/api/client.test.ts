import { describe, expect, it, vi } from "vitest";

import { createApiClient, LogionApiError } from "./client";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("API client security boundary", () => {
  it("rejects absolute, query-bearing and non-v1 paths before fetch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createApiClient({ fetchImplementation });

    for (const path of [
      "https://example.com/api/v1/auth/me",
      "/api/v1/auth/me?token=secret",
      "/health/ready",
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        code: "WEB_API_PATH_INVALID",
      });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("uses same-origin cookies, no-store and explicit JSON headers", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: "user-id" }));
    const client = createApiClient({ fetchImplementation });

    await client.request("/api/v1/auth/me");

    const [, options] = fetchImplementation.mock.calls[0] ?? [];
    expect(options).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(new Headers(options?.headers).get("Accept")).toBe(
      "application/json",
    );
  });

  it("copies only the CSRF cookie into the protected request header", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "ok" }));
    const client = createApiClient({
      cookieSource: () =>
        "theme=dark; logion_csrf=csrf%2Dvalue; private=ignored",
      fetchImplementation,
    });

    await client.request("/api/v1/auth/refresh", {
      csrf: true,
      method: "POST",
    });

    const [, options] = fetchImplementation.mock.calls[0] ?? [];
    const headers = new Headers(options?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-value");
    expect(headers.has("Cookie")).toBe(false);
  });

  it("fails closed before a CSRF-protected request without a cookie", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createApiClient({
      cookieSource: () => "",
      fetchImplementation,
    });

    await expect(
      client.request("/api/v1/auth/refresh", { csrf: true, method: "POST" }),
    ).rejects.toMatchObject({ code: "WEB_CSRF_MISSING", status: 403 });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied credentials and CSRF headers", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createApiClient({ fetchImplementation });

    for (const name of ["Authorization", "Cookie", "X-CSRF-Token"]) {
      await expect(
        client.request("/api/v1/auth/me", {
          headers: { [name]: "caller-controlled" },
        }),
      ).rejects.toMatchObject({ code: "WEB_API_HEADER_INVALID" });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("keeps server error details and response bodies out of the thrown error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          code: "AUTH_INVALID_SESSION",
          message: "The session is no longer valid.",
          details: { leaked_token: "must-not-survive" },
          retryable: false,
          request_id: "request-123",
        },
        { status: 401 },
      ),
    );
    const client = createApiClient({ fetchImplementation });

    const error = await client
      .request("/api/v1/auth/me")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LogionApiError);
    expect(error).toMatchObject({
      code: "AUTH_INVALID_SESSION",
      requestId: "request-123",
      status: 401,
    });
    expect(JSON.stringify(error)).not.toContain("must-not-survive");
  });

  it("rejects non-JSON success and error responses", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("proxy error", { status: 502 }));
    const client = createApiClient({ fetchImplementation });

    await expect(client.request("/api/v1/auth/me")).rejects.toMatchObject({
      code: "WEB_API_RESPONSE_INVALID",
      status: 502,
    });
  });
});
