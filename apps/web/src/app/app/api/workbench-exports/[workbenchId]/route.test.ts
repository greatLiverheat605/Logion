import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const originalApiUrl = process.env.LOGION_PUBLIC_API_URL;

function request(headers: HeadersInit = {}): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("host", "logion.example");
  requestHeaders.set("x-forwarded-proto", "https");
  return new Request(
    `http://localhost:3000/app/api/workbench-exports/${id}?include_links=true`,
    { headers: requestHeaders, method: "POST" },
  );
}

beforeEach(() => {
  process.env.LOGION_PUBLIC_API_URL = "http://api.internal:8000";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiUrl === undefined) delete process.env.LOGION_PUBLIC_API_URL;
  else process.env.LOGION_PUBLIC_API_URL = originalApiUrl;
});

describe("Workbench export browser bridge", () => {
  it("rejects missing or cross-origin browser evidence without forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (await POST(request(), { params: Promise.resolve({ workbenchId: id }) }))
        .status,
    ).toBe(403);
    expect(
      (
        await POST(
          request({
            cookie: "session=opaque; logion_csrf=csrf",
            origin: "https://attacker.example",
            "x-csrf-token": "csrf",
          }),
          { params: Promise.resolve({ workbenchId: id }) },
        )
      ).status,
    ).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only bounded session headers to the configured API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          contract: "workbench.export",
          document: {},
          schemaVersion: 1,
        },
        { headers: { "x-request-id": "request-1" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        authorization: "must-not-forward",
        cookie: "session=opaque; logion_csrf=csrf",
        origin: "https://logion.example",
        "x-csrf-token": "csrf",
      }),
      { params: Promise.resolve({ workbenchId: id }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        `http://api.internal:8000/api/v1/users/me/workbenches/${id}/export?include_links=true`,
      ),
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Cookie: "session=opaque; logion_csrf=csrf",
          Origin: "https://logion.example",
          "X-CSRF-Token": "csrf",
        },
        method: "GET",
        redirect: "error",
      },
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "must-not-forward",
    );
  });

  it("rejects invalid ids and include-links values before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bad = new Request(
      `https://logion.example/app/api/workbench-exports/not-a-uuid?include_links=all`,
      {
        headers: {
          cookie: "session=opaque; logion_csrf=csrf",
          host: "logion.example",
          origin: "https://logion.example",
          "x-csrf-token": "csrf",
          "x-forwarded-proto": "https",
        },
        method: "POST",
      },
    );

    const response = await POST(bad, {
      params: Promise.resolve({ workbenchId: "not-a-uuid" }),
    });
    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
