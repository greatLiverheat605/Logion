import { readFileSync } from "node:fs";

import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { authenticationManifestPath } from "./e2e-environment";

interface AuthenticatedFixtures {
  page: Page;
}

interface AuthenticatedWorkerFixtures {
  accountState: { email: string; password: string; path: string };
  authenticatedContext: BrowserContext;
  authenticatedPage: Page;
}

interface Setting {
  key: string;
  value: string;
  version: number;
}

const defaultPersonaValue = JSON.stringify({
  activePersonaId: "self",
  customPersonas: [],
});

async function resetPersona(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await page.request.get("/api/v1/users/me/settings");
    if (!response.ok()) {
      throw new Error(
        `Authenticated browser settings reset failed to read with status ${response.status()}.`,
      );
    }
    const payload = (await response.json()) as { settings: Setting[] };
    const persona = payload.settings.find(
      (setting) => setting.key === "persona",
    );
    if (persona?.value === defaultPersonaValue) return false;

    const csrf = await page.evaluate(() => {
      for (const part of document.cookie.split(";")) {
        const [name, ...value] = part.trim().split("=");
        if (name !== "logion_csrf") continue;
        try {
          return decodeURIComponent(value.join("="));
        } catch {
          return null;
        }
      }
      return null;
    });
    if (!csrf) {
      throw new Error("Authenticated browser fixture has no CSRF cookie.");
    }
    const saved = await page.request.put("/api/v1/users/me/settings", {
      data: {
        settings: [
          {
            key: "persona",
            value: defaultPersonaValue,
            version: persona?.version ?? 0,
          },
        ],
      },
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": csrf,
      },
    });
    if (saved.ok()) return true;
    if (saved.status() !== 409 || attempt === 1) {
      throw new Error(
        `Authenticated browser settings reset failed to write with status ${saved.status()}.`,
      );
    }
  }
  return false;
}

async function openAuthenticatedApp(
  page: Page,
  account: { email: string; password: string },
): Promise<void> {
  await page.goto("/app/today");
  const shell = page.locator(".app-shell-frame");
  const anonymous = page.getByRole("heading", { name: "需要登录" });
  await expect(shell.or(anonymous)).toBeVisible();
  if (await shell.isVisible()) return;

  const login = await page.request.post("/api/v1/auth/login", {
    data: {
      device_name: "Browser E2E recovery",
      email: account.email,
      password: account.password,
    },
    headers: { Origin: new URL(page.url()).origin },
  });
  if (login.status() !== 200) {
    throw new Error(
      `Authenticated browser recovery failed with status ${login.status()}.`,
    );
  }
  await page.goto("/app/today");
  await expect(page.locator(".app-shell-frame")).toBeVisible();
}

export const test = base.extend<
  AuthenticatedFixtures,
  AuthenticatedWorkerFixtures
>({
  accountState: [
    async ({}, use, workerInfo) => {
      const manifest = JSON.parse(
        readFileSync(authenticationManifestPath, "utf-8"),
      ) as {
        accounts: Array<{ email: string; password: string; path: string }>;
      };
      const account = manifest.accounts[workerInfo.parallelIndex];
      if (!account) {
        throw new Error(
          `No isolated authentication state exists for worker ${workerInfo.parallelIndex}.`,
        );
      }
      await use(account);
    },
    { scope: "worker" },
  ],
  authenticatedContext: [
    async ({ accountState, browser }, use) => {
      const context = await browser.newContext({
        serviceWorkers: "block",
        storageState: accountState.path,
      });
      try {
        await use(context);
      } finally {
        await context.storageState({ path: accountState.path });
        await context.close();
      }
    },
    { scope: "worker" },
  ],
  authenticatedPage: [
    async ({ authenticatedContext }, use) => {
      const page = await authenticatedContext.newPage();
      try {
        await use(page);
      } finally {
        await page.close();
      }
    },
    { scope: "worker" },
  ],
  page: async (
    { accountState, authenticatedContext, authenticatedPage: page },
    use,
  ) => {
    await page.unrouteAll({ behavior: "wait" });
    await authenticatedContext.clearPermissions();
    await page.setViewportSize({ height: 720, width: 1280 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openAuthenticatedApp(page, accountState);
    if (await resetPersona(page)) {
      await page.reload();
      await expect(page.locator(".app-shell-frame")).toBeVisible();
    }
    try {
      await use(page);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  },
});

export { expect } from "@playwright/test";
