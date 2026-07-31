import { describe, expect, it, vi } from "vitest";

import {
  type ApiClient,
  type ApiRequestOptions,
  LogionApiError,
} from "@/lib/api/client";

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
const remotePersona = {
  ...customPersona,
  id: "custom-223e4567-e89b-42d3-a456-426614174000" as const,
  name: "远端画像",
};
const localPersona = {
  ...customPersona,
  id: "custom-323e4567-e89b-42d3-a456-426614174000" as const,
  name: "本地画像",
};

function conflict() {
  return new LogionApiError({
    code: "USER_SETTING_VERSION_CONFLICT",
    message: "conflict",
    status: 409,
  });
}

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

  it("reloads, merges custom personas, and retries one conflicting save", async () => {
    let gets = 0;
    let puts = 0;
    const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
    const api = clientWith((path, options) => {
      calls.push({ path, options });
      if (options?.method === "PUT") {
        puts += 1;
        if (puts === 1) return Promise.reject(conflict());
        return Promise.resolve({
          settings: [{ key: "persona", value: "stored", version: 3 }],
        });
      }
      gets += 1;
      const setting =
        gets === 1
          ? {
              activePersonaId: customPersona.id,
              customPersonas: [customPersona],
            }
          : {
              activePersonaId: remotePersona.id,
              customPersonas: [customPersona, remotePersona],
            };
      return Promise.resolve({
        settings: [
          {
            key: "persona",
            value: JSON.stringify(setting),
            version: gets,
          },
        ],
      });
    });
    const service = new PersonaSettingService(api);
    await service.load();

    await expect(
      service.save({
        activePersonaId: localPersona.id,
        customPersonas: [localPersona],
      }),
    ).resolves.toEqual({
      activePersonaId: localPersona.id,
      customPersonas: [remotePersona, localPersona],
    });

    expect(gets).toBe(2);
    expect(puts).toBe(2);
    const retry = JSON.parse(String(calls[3]?.options?.body));
    expect(retry.settings[0].version).toBe(2);
    expect(JSON.parse(retry.settings[0].value)).toEqual({
      activePersonaId: localPersona.id,
      customPersonas: [remotePersona, localPersona],
    });
  });

  it("does not retry a second version conflict", async () => {
    let gets = 0;
    let puts = 0;
    const api = clientWith((_path, options) => {
      if (options?.method === "PUT") {
        puts += 1;
        return Promise.reject(conflict());
      }
      gets += 1;
      return Promise.resolve({
        settings: [
          {
            key: "persona",
            value: '{"activePersonaId":"self","customPersonas":[]}',
            version: gets,
          },
        ],
      });
    });
    const service = new PersonaSettingService(api);
    await service.load();

    await expect(
      service.save({ activePersonaId: "exam", customPersonas: [] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(gets).toBe(2);
    expect(puts).toBe(2);
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
