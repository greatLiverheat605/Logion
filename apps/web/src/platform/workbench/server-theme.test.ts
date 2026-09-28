import { afterEach, expect, it, vi } from "vitest";
import { readServerTheme } from "./server-theme";

afterEach(() => vi.unstubAllGlobals());

it("reads the authenticated preference without caching or following redirects", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        settings: [{ key: "appearance.theme", value: '"dark"' }],
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  expect(await readServerTheme("synthetic=session")).toBe("dark");
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/users/me/settings?key=appearance.theme"),
    expect.objectContaining({
      headers: { cookie: "synthetic=session" },
      cache: "no-store",
      redirect: "error",
    }),
  );
  request.mockResolvedValue(new Response("", { status: 401 }));
  expect(await readServerTheme("synthetic=other")).toBe("system");
  expect(await readServerTheme(null)).toBe("system");
  expect(request).toHaveBeenCalledTimes(2);
});

it("falls back safely when the API is unreachable or returns invalid data", async () => {
  const request = vi.fn().mockRejectedValue(new Error("unavailable"));
  vi.stubGlobal("fetch", request);
  expect(await readServerTheme("synthetic=session")).toBe("system");
  request.mockResolvedValue(
    new Response(
      JSON.stringify({
        settings: [{ key: "appearance.theme", value: '"<script>"' }],
      }),
    ),
  );
  expect(await readServerTheme("synthetic=session")).toBe("system");
});
