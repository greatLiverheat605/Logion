import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { components } from "@logion/contracts";

export async function downloadResearchExport(
  page: Page,
  schema = "logion-export-v03",
) {
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/data-exports"),
  );
  await page.getByRole("button", { name: "创建导出", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "确认创建", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(202);
  const job =
    (await response.json()) as components["schemas"]["ExportResponse"];
  expect(job.schema_version).toBe(schema);
  await expect(dialog).toHaveCount(0);
  const tasks = page.getByRole("region", { name: "导出任务", exact: true });
  await expect(
    tasks.getByRole("button", { name: "下载 ZIP", exact: true }).first(),
  ).toBeEnabled();
  const event = page.waitForEvent("download");
  await tasks
    .getByRole("button", { name: "下载 ZIP", exact: true })
    .first()
    .click();
  const download = await event;
  expect(download.suggestedFilename()).toBe(`logion-export-${job.id}.zip`);
  const artifact = await download.path();
  expect(artifact).not.toBeNull();
  const inspected = spawnSync(
    "uv",
    [
      "run",
      "python",
      "-c",
      "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read('manifest.json')); d=json.loads(z.read('data.json')); assert m['counts']=={k:len(v) for k,v in d['objects'].items()}; print(json.dumps(d))",
      artifact!,
    ],
    { encoding: "utf8" },
  );
  expect(inspected.status, inspected.stderr).toBe(0);
  const digest = createHash("sha256")
    .update(readFileSync(artifact!))
    .digest("hex");
  await tasks.getByText("校验 SHA-256", { exact: true }).first().click();
  await expect(tasks.getByText(digest, { exact: true })).toBeVisible();
  return JSON.parse(inspected.stdout) as {
    schema_version: string;
    objects: Record<string, Record<string, unknown>[]>;
  };
}
