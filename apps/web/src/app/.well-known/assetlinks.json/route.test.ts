import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Android Digital Asset Links route", () => {
  it("fails closed when release signing is not configured", async () => {
    vi.stubEnv("LOGION_ANDROID_CERT_SHA256_FINGERPRINTS", "[]");

    const response = GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("publishes the configured release certificate without cookies", async () => {
    vi.stubEnv(
      "LOGION_ANDROID_CERT_SHA256_FINGERPRINTS",
      JSON.stringify([fingerprint]),
    );

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    await expect(response.json()).resolves.toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "work.logion.app",
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ]);
  });
});
