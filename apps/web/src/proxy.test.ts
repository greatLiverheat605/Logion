import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy CSP", () => {
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
