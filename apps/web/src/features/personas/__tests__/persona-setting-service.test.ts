import { describe, expect, it, vi } from "vitest";

import type { ApiClient, ApiRequestOptions } from "@/lib/api/client";

import {
  parsePersonaSetting,
  PersonaSettingService,
} from "../persona-setting-service";

const customPersona = {
  id: "custom-123e4567-e89b-42d3-a456-426614174000" as const,
  name: "我的混合画像",
  icon: "🎯",
  description: "研究 + 考试",
  routes: [
    "/app/today",
    "/app/exam",
    "/app/settings",
    "/app/profile",
    "/app/help",
  ],
  isBuiltin: false,
};

function clientWith(
  implementation: (path: string, options?: ApiRequestOptions) => unknown,
): ApiClient {
  return {
    request: vi.fn(implementation) as ApiClient["request"],
  };
}

describe("PersonaSettingService", () => {
  it("loads and deserializes the persona setting through the existing endpoint", async () => {
    const api = clientWith(() =>
      Promise.resolve({
        settings: [
          {
            key: "persona",
            value: JSON.stringify({
              activePersonaId: customPersona.id,
              customPersonas: [customPersona],
            }),
            version: 4,
          },
        ],
      }),
    );
    const service = new PersonaSettingService(api);

    await expect(service.load()).resolves.toEqual({
      activePersonaId: customPersona.id,
      customPersonas: [customPersona],
    });
    expect(api.request).toHaveBeenCalledWith("/api/v1/users/me/settings", {
      query: { key: "persona" },
    });
  });

  it("saves with the loaded version and advances to the returned version", async () => {
    const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
    const api = clientWith((path, options) => {
      calls.push({ path, options });
      if (options?.method === "PUT") {
        return Promise.resolve({
          settings: [{ key: "persona", value: "stored", version: 8 }],
        });
      }
      return Promise.resolve({
        settings: [
          {
            key: "persona",
            value: '{"activePersonaId":"self","customPersonas":[]}',
            version: 7,
          },
        ],
      });
    });
    const service = new PersonaSettingService(api);
    await service.load();
    await service.save({ activePersonaId: "exam", customPersonas: [] });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.path).toBe("/api/v1/users/me/settings");
    expect(calls[1]?.options).toMatchObject({ csrf: true, method: "PUT" });
    expect(JSON.parse(String(calls[1]?.options?.body))).toEqual({
      settings: [
        {
          key: "persona",
          value: '{"activePersonaId":"exam","customPersonas":[]}',
          version: 7,
        },
      ],
    });
  });

  it("rejects malformed or unsafe custom persona data", () => {
    expect(() => parsePersonaSetting("not-json")).toThrow();
    expect(() =>
      parsePersonaSetting(
        JSON.stringify({
          activePersonaId: "custom-not-a-uuid",
          customPersonas: [
            {
              ...customPersona,
              id: "custom-not-a-uuid",
              routes: ["https://example.com"],
            },
          ],
        }),
      ),
    ).toThrow("invalid");
    expect(() =>
      parsePersonaSetting(
        JSON.stringify({
          activePersonaId: customPersona.id,
          customPersonas: [
            {
              ...customPersona,
              routes: ["/app/today", "/app/settings"],
            },
          ],
        }),
      ),
    ).toThrow("invalid");
  });
});
