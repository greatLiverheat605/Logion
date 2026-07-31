import type { components } from "@logion/contracts";

import { browserApiClient, type ApiClient } from "@/lib/api/client";

type UserSettingListResponse = components["schemas"]["UserSettingListResponse"];
type UserSettingResponse = components["schemas"]["UserSettingResponse"];

const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;

export class UserSettingService {
  private readonly versions = new Map<string, number>();

  constructor(private readonly api: ApiClient = browserApiClient) {}

  async get(key: string): Promise<UserSettingResponse | null> {
    if (!KEY_PATTERN.test(key)) throw new Error("The setting key is invalid.");
    const response = await this.api.request<UserSettingListResponse>(
      "/api/v1/users/me/settings",
      { query: { key } },
    );
    const setting = response.settings.find((item) => item.key === key) ?? null;
    this.versions.set(key, setting?.version ?? 0);
    return setting;
  }

  async set(key: string, value: string): Promise<UserSettingResponse> {
    if (!KEY_PATTERN.test(key)) throw new Error("The setting key is invalid.");
    if (value.length > 8192) throw new Error("The setting value is too long.");
    if (!this.versions.has(key)) await this.get(key);
    const response = await this.api.request<UserSettingListResponse>(
      "/api/v1/users/me/settings",
      {
        body: JSON.stringify({
          settings: [{ key, value, version: this.versions.get(key) ?? 0 }],
        }),
        csrf: true,
        method: "PUT",
      },
    );
    const saved = response.settings.find((item) => item.key === key);
    if (!saved) throw new Error("The user setting response is invalid.");
    this.versions.set(key, saved.version);
    return saved;
  }
}

export const userSettingService = new UserSettingService();
