import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { request, type FullConfig } from "@playwright/test";

import {
  authenticationManifestPath,
  authenticationStateDirectory,
  canProvisionAccounts,
  configuredCredentials,
  e2eBaseUrl,
  shouldRunAuthenticated,
} from "./e2e-environment";

interface Setting {
  key: string;
  value: string;
  version: number;
}

async function seedAccount(
  index: number,
  email: string,
  password: string,
  provision: boolean,
): Promise<{
  authenticatedAt: number;
  email: string;
  password: string;
  path: string;
}> {
  const origin = e2eBaseUrl.origin;
  const api = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    const authentication = provision
      ? await api.post("/api/v1/auth/register", {
          data: {
            device_name: `Browser worker ${index}`,
            email,
            password,
          },
        })
      : await api.post("/api/v1/auth/login", {
          data: {
            device_name: `Browser worker ${index}`,
            email,
            password,
          },
        });
    const expectedStatus = provision ? 201 : 200;
    if (authentication.status() !== expectedStatus) {
      throw new Error(
        `Authenticated browser fixture setup failed with status ${authentication.status()}.`,
      );
    }
    const authenticatedAt = Date.now();

    const currentResponse = await api.get("/api/v1/users/me/settings");
    if (!currentResponse.ok()) {
      throw new Error(
        `Authenticated browser settings read failed with status ${currentResponse.status()}.`,
      );
    }
    const current = (await currentResponse.json()) as { settings: Setting[] };
    const byKey = new Map(
      current.settings.map((setting) => [setting.key, setting]),
    );
    const persona = byKey.get("persona");
    const onboarding = byKey.get("onboarding_completed");
    const updates = [];
    const personaValue = JSON.stringify({
      activePersonaId: "self",
      customPersonas: [],
    });
    if (persona?.value !== personaValue) {
      updates.push({
        key: "persona",
        value: personaValue,
        version: persona?.version ?? 0,
      });
    }
    if (onboarding?.value !== "true") {
      updates.push({
        key: "onboarding_completed",
        value: "true",
        version: onboarding?.version ?? 0,
      });
    }
    if (updates.length > 0) {
      const state = await api.storageState();
      const csrf = state.cookies.find(
        (cookie) => cookie.name === "logion_csrf",
      )?.value;
      if (!csrf)
        throw new Error("Authenticated browser fixture has no CSRF cookie.");
      const saved = await api.put("/api/v1/users/me/settings", {
        data: { settings: updates },
        headers: { "X-CSRF-Token": csrf },
      });
      if (!saved.ok()) {
        throw new Error(
          `Authenticated browser settings seed failed with status ${saved.status()}.`,
        );
      }
    }

    const statePath = resolve(
      authenticationStateDirectory,
      `worker-${index}.json`,
    );
    await api.storageState({ path: statePath });
    return { authenticatedAt, email, password, path: statePath };
  } finally {
    await api.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  await rm(authenticationStateDirectory, { force: true, recursive: true });
  if (!shouldRunAuthenticated) return;
  await mkdir(authenticationStateDirectory, { recursive: true });

  const count = configuredCredentials === null ? config.workers : 1;
  const accounts: Array<{
    authenticatedAt: number;
    email: string;
    password: string;
    path: string;
  }> = [];
  for (let index = 0; index < count; index += 1) {
    const credentials = configuredCredentials ?? {
      email: `browser-worker-${randomUUID()}@example.com`,
      password: `${randomBytes(24).toString("base64url")}Aa1!`,
    };
    accounts.push(
      await seedAccount(
        index,
        credentials.email,
        credentials.password,
        canProvisionAccounts && configuredCredentials === null,
      ),
    );
  }
  await writeFile(authenticationManifestPath, JSON.stringify({ accounts }), {
    encoding: "utf-8",
    mode: 0o600,
  });
}
