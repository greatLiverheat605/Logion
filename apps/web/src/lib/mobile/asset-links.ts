const ANDROID_PACKAGE_NAME = "work.logion.app";
const MAX_FINGERPRINTS = 4;
const SHA256_FINGERPRINT = /^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

type AssetLinkStatement = {
  relation: ["delegate_permission/common.handle_all_urls"];
  target: {
    namespace: "android_app";
    package_name: typeof ANDROID_PACKAGE_NAME;
    sha256_cert_fingerprints: string[];
  };
};

export function createAndroidAssetLinks(
  rawFingerprints: string | undefined,
): AssetLinkStatement[] | null {
  if (rawFingerprints === undefined || rawFingerprints.trim() === "") {
    return null;
  }

  const parsed: unknown = JSON.parse(rawFingerprints);
  if (!Array.isArray(parsed)) {
    throw new Error("Android certificate fingerprints must be a JSON array.");
  }
  if (parsed.length === 0) return null;
  if (parsed.length > MAX_FINGERPRINTS) {
    throw new Error(`At most ${MAX_FINGERPRINTS} fingerprints are supported.`);
  }

  const fingerprints = [
    ...new Set(
      parsed.map((fingerprint) => {
        if (
          typeof fingerprint !== "string" ||
          !SHA256_FINGERPRINT.test(fingerprint)
        ) {
          throw new Error("An Android certificate fingerprint is invalid.");
        }
        return fingerprint.toUpperCase();
      }),
    ),
  ];

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
