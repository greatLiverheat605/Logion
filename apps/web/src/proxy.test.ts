import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";
import { checkedDestination } from "./platform/workbench/legacy-routes";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy CSP", () => {
  it("gates every new route with a real 404 and keeps legacy routes available", () => {
    vi.stubEnv("LOGION_RESEARCH_V3_ENABLED", "false");
    for (const path of [
      "/today",
      "/library",
      "/read/example",
      "/questions",
      "/graph",
      "/review",
      "/plan",
      "/settings",
      "/legacy-data-check",
      "/settings/legacy-data",
    ]) {
      const response = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "default-src 'self'",
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(
      proxy(new NextRequest("http://localhost:3000/app/today")).status,
    ).toBe(200);
    vi.stubEnv("LOGION_RESEARCH_V3_ENABLED", "true");
    expect(proxy(new NextRequest("http://localhost:3000/today")).status).toBe(
      200,
    );
  });
  it("routes old page GETs through count inspection and allows only the explicit sync entry", () => {
    vi.stubEnv("LOGION_RESEARCH_V3_ENABLED", "true");
    for (const [path, destination] of [
      ["/app/records?secret=discarded", "/records"],
      ["/app/research", "/library"],
      ["/app/planning", "/plan"],
      ["/app/ai", "/settings/ai"],
      ["/app/exam", "/today"],
      ["/app/sync", "/today"],
      ["/app/__proto__", "/today"],
      ["/app/records?legacy=sync", "/records"],
    ]) {
      const response = proxy(new NextRequest(`https://logion.test${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://logion.test/legacy-data-check?next=${encodeURIComponent(destination!)}`,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "frame-ancestors 'none'",
      );
    }
    for (const path of [
      "/app/sync?legacy=sync",
      "/app/api/example",
      "/app/api",
      "/apple",
      "/onboarding",
    ]) {
      expect(proxy(new NextRequest(`https://logion.test${path}`)).status).toBe(
        200,
      );
    }
    expect(
      proxy(
        new NextRequest("https://logion.test/app/records", { method: "POST" }),
      ).status,
    ).toBe(200);
    expect(checkedDestination("https://evil.test")).toBe("/today");
    expect(checkedDestination("//evil.test")).toBe("/today");
    expect(checkedDestination("/app/sync")).toBe("/today");
    expect(checkedDestination("/records")).toBe("/records");
    const chosen = proxy(
      new NextRequest("https://logion.test/app/sync?legacy=sync"),
    );
    expect(chosen.cookies.get("logion_legacy_sync")).toMatchObject({
      value: "1",
      path: "/app/sync",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });
    expect(
      proxy(
        new NextRequest("https://logion.test/app/sync?tab=conflict", {
          headers: { Cookie: "logion_legacy_sync=1" },
        }),
      ).status,
    ).toBe(200);
    expect(
      proxy(
        new NextRequest("https://logion.test/app/records", {
          headers: { Cookie: "logion_legacy_sync=1" },
        }),
      ).status,
    ).toBe(307);
  });
  it("allows Next development tooling without weakening production CSP", () => {
    vi.stubEnv("NODE_ENV", "development");
    const development = proxy(
      new NextRequest("http://localhost:3000/auth/login"),
    ).headers.get("Content-Security-Policy");

    expect(development).toContain("'unsafe-eval'");
    expect(development).toContain("style-src 'self' 'unsafe-inline'");

    vi.stubEnv("NODE_ENV", "production");
    const production = proxy(
      new NextRequest("https://logion.test/auth/login"),
    ).headers.get("Content-Security-Policy");

    expect(production).not.toContain("'unsafe-eval'");
    expect(production).toMatch(/style-src 'self' 'nonce-[^']+'/);
    expect(production).not.toContain("style-src 'self' 'unsafe-inline'");
  });
});
