import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

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
