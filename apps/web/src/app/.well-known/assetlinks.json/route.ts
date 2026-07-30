import { createAndroidAssetLinks } from "@/lib/mobile/asset-links";

const disabledHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export function GET(): Response {
  try {
    const statements = createAndroidAssetLinks(
      process.env.LOGION_ANDROID_CERT_SHA256_FINGERPRINTS,
    );
    if (statements === null) {
      return new Response('{"detail":"Not Found"}', {
        status: 404,
        headers: disabledHeaders,
      });
    }

    return Response.json(statements, {
      headers: {
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    });
  } catch {
    console.error("Android Digital Asset Links configuration is invalid.");
    return new Response('{"detail":"Service Unavailable"}', {
      status: 503,
      headers: disabledHeaders,
    });
  }
}
