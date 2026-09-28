import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function expectOnlineOnly(page: Page) {
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
}

test("real research API persists literature and preferences, rejects conflicts and gates disabled routes", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const origin = baseURL!;
  const credentials = {
    email: `research-browser-${randomUUID()}@example.com`,
    password: `${randomBytes(24).toString("base64url")}Aa1!`,
    device_name: "Synthetic research browser",
  };
  const registration = await context.request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: credentials,
  });
  expect(registration.status()).toBe(201);
  await page.goto("/library");
  await expect(
    page.getByRole("heading", { name: "文献库", exact: true }),
  ).toBeVisible();
  const title = "真实 API 合成文献";
  const doi = `10.1234/${randomUUID()}`;
  await page.getByRole("button", { name: "新建文献" }).click();
  const dialog = page.getByRole("dialog", { name: "新建文献" });
  await dialog.getByLabel("标题", { exact: true }).fill(title);
  await dialog.getByLabel("DOI", { exact: true }).fill(doi);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/library/resources"),
  );
  await dialog.getByRole("button", { name: "保存文献" }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const resource = await createdResponse.json();
  const libraryPath = new URL(createdResponse.url()).pathname;
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();

  await page.getByRole("button", { name: "新建文献" }).click();
  await dialog
    .getByLabel("标题", { exact: true })
    .fill("重复 DOI 的输入须保留");
  await dialog.getByLabel("DOI", { exact: true }).fill(doi);
  const duplicate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(libraryPath),
  );
  await dialog.getByRole("button", { name: "保存文献" }).click();
  const duplicateResponse = await duplicate;
  expect(duplicateResponse.status()).toBe(409);
  expect((await duplicateResponse.json()).details.existing_id).toBe(
    resource.id,
  );
  await expect(dialog.getByRole("alert")).toContainText("已有条目");
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
    "重复 DOI 的输入须保留",
  );
  await expect(dialog.getByLabel("DOI", { exact: true })).toHaveValue(doi);
  await page.reload();
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();
  const persisted = await context.request.get(libraryPath);
  expect(persisted.status()).toBe(200);
  expect(
    (await persisted.json()).resources.map((item: { id: string }) => item.id),
  ).toEqual([resource.id]);

  await page.getByRole("button", { name: "外观", exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/users/me/settings"),
  );
  await page.getByRole("menuitem", { name: "夜间", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const current = await context.request.get(
    "/api/v1/users/me/settings?key=appearance.theme",
  );
  expect(current.status()).toBe(200);
  const setting = (await current.json()).settings[0];
  expect(setting.value).toBe('"dark"');
  expect(setting.version).toBe(1);
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )!.value;
  const stale = await context.request.put("/api/v1/users/me/settings", {
    headers: { Origin: origin, "X-CSRF-Token": csrf },
    data: {
      settings: [
        { key: setting.key, value: '"light"', version: setting.version - 1 },
      ],
    },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("USER_SETTING_VERSION_CONFLICT");
  await page.goto(`/read/${resource.id}`);
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(
    page.getByRole("complementary", { name: "阅读工具提示" }),
  ).toHaveCount(0);
  await expectOnlineOnly(page);

  // No storageState copy: independently authenticate in an empty browser context.
  const fresh = await browser.newContext({ baseURL: origin });
  try {
    const login = await fresh.request.post("/api/v1/auth/login", {
      headers: { Origin: origin },
      data: credentials,
    });
    expect(login.status()).toBe(200);
    const other = await fresh.newPage();
    await other.goto("/library");
    await expect(
      other.getByRole("button", { name: new RegExp(title) }),
    ).toBeVisible();
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await other.goto(`/read/${resource.id}`);
    await expect(
      other.getByRole("region", { name: "三栏阅读布局" }),
    ).toBeVisible();
    await expect(
      other.getByRole("complementary", { name: "阅读工具提示" }),
    ).toHaveCount(0);
    await expectOnlineOnly(other);
  } finally {
    await fresh.close();
  }
  const disabled = await context.request.get(
    `http://127.0.0.1:8001${libraryPath}`,
  );
  expect(disabled.status()).toBe(404);
  expect((await disabled.json()).code).toBe("NOT_FOUND");
});
