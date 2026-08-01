import { describe, expect, it, vi } from "vitest";

import type { ApiClient, ApiRequestOptions } from "@/lib/api/client";

import { IntegrationCapabilityService } from "./integration-capability-service";

function clientWith(
  implementation: (path: string, options?: ApiRequestOptions) => unknown,
): ApiClient {
  return { request: vi.fn(implementation) as ApiClient["request"] };
}

describe("IntegrationCapabilityService", () => {
  it("normalizes malformed lists and only exposes private import targets", async () => {
    const api = clientWith((path) => {
      if (path.endsWith("data-exports"))
        return Promise.resolve({ exports: {} });
      if (path.endsWith("data-imports")) return Promise.resolve(null);
      return Promise.resolve({
        spaces: [
          { id: "private-space", visibility: "private" },
          { id: "shared-space", visibility: "shared" },
        ],
      });
    });
    const service = new IntegrationCapabilityService(api);

    await expect(service.loadPortability("workspace-1")).resolves.toEqual({
      exports: [],
      imports: [],
      privateSpaces: [{ id: "private-space", visibility: "private" }],
    });
    expect(api.request).toHaveBeenCalledTimes(3);
  });

  it("uses the existing Calendar Feed endpoints and protected write shape", async () => {
    const api = clientWith(() => Promise.resolve({ token: "one-time-token" }));
    const service = new IntegrationCapabilityService(api);

    await expect(
      service.createCalendarFeed("workspace-1", {
        id: "feed-1",
        name: "My calendar",
      }),
    ).resolves.toEqual({ token: "one-time-token" });
    await service.revokeCalendarFeed("workspace-1", "feed-1", 3);

    expect(api.request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/workspaces/workspace-1/calendar-feeds",
      {
        body: JSON.stringify({ id: "feed-1", name: "My calendar" }),
        csrf: true,
        method: "POST",
      },
    );
    expect(api.request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/workspaces/workspace-1/calendar-feeds/feed-1/revoke",
      {
        body: JSON.stringify({ expected_version: 3 }),
        csrf: true,
        method: "POST",
      },
    );
  });

  it("rejects a Calendar response without the one-time token", async () => {
    const service = new IntegrationCapabilityService(
      clientWith(() => Promise.resolve({ token: "" })),
    );

    await expect(
      service.createCalendarFeed("workspace-1", {
        id: "feed-1",
        name: "My calendar",
      }),
    ).rejects.toMatchObject({ code: "WEB_API_RESPONSE_INVALID" });
  });

  it("reuses export and import endpoints without changing their contracts", async () => {
    const api = clientWith(() => Promise.resolve({}));
    const service = new IntegrationCapabilityService(api);

    await service.createExport("workspace-1", {
      confirmation: "EXPORT",
      id: "export-1",
    });
    await service.cancelExport("workspace-1", "export-1", 2);
    await service.previewImport("workspace-1", {
      content: "@article{test}",
      id: "import-1",
      source_filename: "papers.bib",
      source_format: "bibtex",
    });
    await service.commitImport("workspace-1", "import-1", {
      expected_version: 4,
      target_space_id: "private-space",
    });

    const calls = vi.mocked(api.request).mock.calls;
    expect(calls.map(([path]) => path)).toEqual([
      "/api/v1/workspaces/workspace-1/data-exports",
      "/api/v1/workspaces/workspace-1/data-exports/export-1/cancel",
      "/api/v1/workspaces/workspace-1/data-imports/preview",
      "/api/v1/workspaces/workspace-1/data-imports/import-1/commit",
    ]);
    expect(JSON.parse(String(calls[3]?.[1]?.body))).toEqual({
      confirmation: "IMPORT",
      expected_version: 4,
      target_space_id: "private-space",
    });
    for (const [, options] of calls) {
      expect(options).toMatchObject({ csrf: true, method: "POST" });
    }
  });

  it("propagates API errors without replacing request metadata", async () => {
    const error = new Error("request failed");
    const service = new IntegrationCapabilityService(
      clientWith(() => Promise.reject(error)),
    );

    await expect(service.listCalendarFeeds("workspace-1")).rejects.toBe(error);
  });
});
