import { describe, expect, it, vi } from "vitest";

import type { ApiClient, ApiRequestOptions } from "@/lib/api/client";

import { UserSettingService } from "../user-setting-service";

function clientWith(
  implementation: (path: string, options?: ApiRequestOptions) => unknown,
): ApiClient {
  return { request: vi.fn(implementation) as ApiClient["request"] };
}

describe("UserSettingService", () => {
  it("reads a single setting with an encoded query", async () => {
    const api = clientWith(() =>
      Promise.resolve({
        settings: [{ key: "theme", value: "dark", version: 2 }],
      }),
    );
    const service = new UserSettingService(api);

    await expect(service.get("theme")).resolves.toEqual({
      key: "theme",
      value: "dark",
      version: 2,
    });
    expect(api.request).toHaveBeenCalledWith("/api/v1/users/me/settings", {
      query: { key: "theme" },
    });
  });

  it("uses the loaded version for a protected update", async () => {
    const calls: ApiRequestOptions[] = [];
    const api = clientWith((_path, options) => {
      calls.push(options ?? {});
      return options?.method === "PUT"
        ? Promise.resolve({
            settings: [
              { key: "onboarding_completed", value: "true", version: 4 },
            ],
          })
        : Promise.resolve({
            settings: [
              { key: "onboarding_completed", value: "false", version: 3 },
            ],
          });
    });
    const service = new UserSettingService(api);

    await service.set("onboarding_completed", "true");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ csrf: true, method: "PUT" });
    expect(JSON.parse(String(calls[1]?.body))).toEqual({
      settings: [
        {
          key: "onboarding_completed",
          value: "true",
          version: 3,
        },
      ],
    });
  });
});
