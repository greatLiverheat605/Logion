import { apiOrigin } from "@/lib/api/api-origin";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store" };

function error(status: number, code: string, message: string): Response {
  return Response.json(
    { code, message, request_id: "unavailable", retryable: false },
    { headers: NO_STORE, status },
  );
}

function requestOrigin(request: Request): string | null {
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const protocol =
    forwardedProtocol ?? new URL(request.url).protocol.slice(0, -1);
  if (!host || !["http", "https"].includes(protocol)) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workbenchId: string }> },
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin === null || origin !== requestOrigin(request)) {
    return error(
      403,
      "AUTH_ORIGIN_INVALID",
      "The request origin is not allowed.",
    );
  }
  const csrf = request.headers.get("x-csrf-token");
  const cookie = request.headers.get("cookie");
  if (!csrf || !cookie) {
    return error(
      403,
      "AUTH_CSRF_INVALID",
      "The request could not be authorized.",
    );
  }
  const { workbenchId } = await context.params;
  const includeLinks = new URL(request.url).searchParams.get("include_links");
  if (
    !UUID.test(workbenchId) ||
    !["true", "false"].includes(includeLinks ?? "")
  ) {
    return error(
      422,
      "WORKBENCH_SCHEMA_INVALID",
      "The Workbench request is invalid.",
    );
  }

  const upstream = new URL(
    `/api/v1/users/me/workbenches/${workbenchId}/export`,
    apiOrigin(),
  );
  upstream.searchParams.set("include_links", includeLinks!);
  let response: Response;
  try {
    response = await fetch(upstream, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        Origin: origin,
        "X-CSRF-Token": csrf,
      },
      method: "GET",
      redirect: "error",
    });
  } catch {
    return error(
      503,
      "WORKBENCH_SERVICE_UNAVAILABLE",
      "The Workbench service is temporarily unavailable.",
    );
  }

  const headers = new Headers(NO_STORE);
  const contentType = response.headers.get("content-type");
  const requestId = response.headers.get("x-request-id");
  if (contentType) headers.set("Content-Type", contentType);
  if (requestId) headers.set("X-Request-Id", requestId);
  return new Response(await response.arrayBuffer(), {
    headers,
    status: response.status,
  });
}
