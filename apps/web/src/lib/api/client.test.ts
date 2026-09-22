import { describe, expect, it, vi } from "vitest";

import { createApiClient, LogionApiError, type ApiZipResponse } from "./client";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("API client security boundary", () => {
  it("downloads an explicit ZIP response with the server filename and normal request protections", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("zip-bytes", {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition":
            'attachment; filename="logion-export-test.zip"',
        },
      }),
    );
    const client = createApiClient({ fetchImplementation });
    const result = await client.request<ApiZipResponse>(
      "/api/v1/workspaces/a/data-exports/b/download",
      { responseType: "zip" },
    );
    expect(await result.blob.text()).toBe("zip-bytes");
    expect(result.filename).toBe("logion-export-test.zip");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const options = fetchImplementation.mock.calls[0]![1]!;
    expect(options).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(options).not.toHaveProperty("responseType");
    expect(new Headers(options.headers).get("accept")).toContain(
      "application/zip",
    );
  });

  it.each([
    [404, "EXPORT_NOT_FOUND"],
    [401, "AUTH_INVALID_SESSION"],
  ])(
    "rejects download error %s and notifies authentication only when required",
    async (status, code) => {
      const onAuthenticationRequired = vi.fn();
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            code,
            message: "Denied",
            request_id: "download-rejected",
            retryable: false,
          },
          { status },
        ),
      );
      const client = createApiClient({
        fetchImplementation,
        onAuthenticationRequired,
      });
      await expect(
        client.request("/api/v1/workspaces/a/data-exports/b/download", {
          responseType: "zip",
        }),
      ).rejects.toMatchObject({ code, status });
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      expect(onAuthenticationRequired).toHaveBeenCalledTimes(
        status === 401 ? 1 : 0,
      );
    },
  );

  it("rejects a successful JSON or HTML payload requested as a ZIP", async () => {
    for (const type of ["application/json", "text/html"]) {
      const client = createApiClient({
        fetchImplementation: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("not a zip", { headers: { "Content-Type": type } }),
          ),
      });
      await expect(
        client.request("/api/v1/workspaces/a/data-exports/b/download", {
          responseType: "zip",
        }),
      ).rejects.toMatchObject({ code: "WEB_API_RESPONSE_INVALID" });
    }
  });
  it("reports rejected business writes once without replaying them", async () => {
    const onAuthenticationRequired = vi.fn();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse(
          {
            code: "AUTH_INVALID_SESSION",
            message: "Sign in",
            request_id: "request-1",
            retryable: false,
          },
          { status: 401 },
        ),
      );
    const client = createApiClient({
      fetchImplementation,
      onAuthenticationRequired,
    });
    await expect(
      client.request("/api/v1/workspaces", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_SESSION" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
    for (const path of [
      "/api/v1/auth/session",
      "/api/v1/auth/refresh",
      "/api/v1/auth/logout",
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({ status: 401 });
    }
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
  });

  it("reports missing business CSRF but never turns a permission denial into login", async () => {
    const onAuthenticationRequired = vi.fn();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse(
          {
            code: "AUTH_CSRF_INVALID",
            message: "Denied",
            request_id: "request-1",
            retryable: false,
          },
          { status: 403 },
        ),
      );
    const client = createApiClient({
      cookieSource: () => "",
      fetchImplementation,
      onAuthenticationRequired,
    });
    await expect(
      client.request("/api/v1/workspaces", { method: "POST", csrf: true }),
    ).rejects.toMatchObject({ code: "WEB_CSRF_MISSING" });
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).not.toHaveBeenCalled();
    await expect(client.request("/api/v1/workspaces")).rejects.toMatchObject({
      code: "AUTH_CSRF_INVALID",
    });
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
  });

  it("advertises deletion handling on all sync transports without changing other requests", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({}));
    const client = createApiClient({ fetchImplementation });
    for (const operation of ["push", "pull", "bootstrap"]) {
      await client.request(
        `/api/v1/workspaces/test-workspace/sync/${operation}`,
        {
          method: "POST",
          body: "{}",
        },
      );
    }
    await client.request("/api/v1/auth/me");
    expect(
      fetchImplementation.mock.calls.map(([, options]) =>
        new Headers(options?.headers).get("X-Logion-Sync-Capabilities"),
      ),
    ).toEqual([
      "entity-deletion-v1",
      "entity-deletion-v1",
      "entity-deletion-v1",
      null,
    ]);
  });

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

  it("encodes caller query values without allowing a query-bearing path", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ settings: [] }));
    const client = createApiClient({ fetchImplementation });

    await client.request("/api/v1/users/me/settings", {
      query: { key: "persona & theme" },
    });

    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/users/me/settings?key=persona+%26+theme",
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
