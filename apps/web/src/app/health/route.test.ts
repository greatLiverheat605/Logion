import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const originalVersion = process.env.LOGION_VERSION;

afterEach(() => {
  if (originalVersion === undefined) delete process.env.LOGION_VERSION;
  else process.env.LOGION_VERSION = originalVersion;
});

describe("web health route", () => {
  it("returns the deployed build version without caching it", async () => {
    process.env.LOGION_VERSION = "37e2e005d5594da31daade87d67a4ea183283b06";

    const response = GET();

    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      service: "web",
      status: "ok",
      version: "37e2e005d5594da31daade87d67a4ea183283b06",
    });
  });

  it("reports an unknown version when deployment metadata is absent", async () => {
    delete process.env.LOGION_VERSION;

    await expect(GET().json()).resolves.toMatchObject({ version: "unknown" });
  });

  it("reports unknown when LOGION_VERSION is empty string", async () => {
    process.env.LOGION_VERSION = "";

    await expect(GET().json()).resolves.toMatchObject({ version: "unknown" });
  });

  it("reports unknown when LOGION_VERSION is whitespace", async () => {
    process.env.LOGION_VERSION = "   ";

    await expect(GET().json()).resolves.toMatchObject({ version: "unknown" });
  });
});
