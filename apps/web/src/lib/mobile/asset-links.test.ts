import { describe, expect, it } from "vitest";

import { createAndroidAssetLinks } from "./asset-links";

const fingerprint = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, "0"),
).join(":");

describe("createAndroidAssetLinks", () => {
  it("keeps the endpoint disabled until a release fingerprint is configured", () => {
    expect(createAndroidAssetLinks(undefined)).toBeNull();
    expect(createAndroidAssetLinks("[]")).toBeNull();
  });

  it("publishes a normalized statement for the approved application", () => {
    expect(createAndroidAssetLinks(JSON.stringify([fingerprint]))).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "work.logion.app",
          sha256_cert_fingerprints: [fingerprint.toUpperCase()],
        },
      },
    ]);
  });

  it("rejects malformed fingerprints and oversized allowlists", () => {
    expect(() => createAndroidAssetLinks('["not-a-fingerprint"]')).toThrow(
      "invalid",
    );
    expect(() =>
      createAndroidAssetLinks(
        JSON.stringify([
          fingerprint,
          fingerprint.replace(/^00/, "20"),
          fingerprint.replace(/^00/, "30"),
          fingerprint.replace(/^00/, "40"),
          fingerprint.replace(/^00/, "50"),
        ]),
      ),
    ).toThrow("At most 4");
  });
});
