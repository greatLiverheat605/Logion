import { type NextRequest, NextResponse } from "next/server";
import { isWorkbenchPath } from "./platform/workbench/routes";
import { legacyDestination } from "./platform/workbench/legacy-routes";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const isHttps =
    request.nextUrl.protocol === "https:" || forwardedProtocol === "https";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    isDevelopment
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${nonce}'`,
    // Radix and Next's route announcer use React style attributes for
    // positioning and focus affordances; keep style elements nonce-gated.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (isHttps) directives.push("upgrade-insecure-requests");
  const csp = directives.join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const workbench = isWorkbenchPath(request.nextUrl.pathname);
  const research = process.env.LOGION_RESEARCH_V3_ENABLED === "true";
  const path = request.nextUrl.pathname;
  const legacy =
    /^\/app(?:\/|$)/.test(path) && !/^\/app\/api(?:\/|$)/.test(path);
  const oldSync =
    path === "/app/sync" &&
    request.nextUrl.searchParams.get("legacy") === "sync";
  const continueSync =
    path === "/app/sync" &&
    request.cookies.get("logion_legacy_sync")?.value === "1";
  const checkUrl = request.nextUrl.clone();
  checkUrl.pathname = "/legacy-data-check";
  checkUrl.search = "";
  checkUrl.searchParams.set("next", legacyDestination(path));
  headers.set("x-logion-workbench", workbench ? "1" : "0");
  const response =
    workbench && !research
      ? new NextResponse("Not Found", { status: 404 })
      : research &&
          legacy &&
          !oldSync &&
          !continueSync &&
          request.method === "GET"
        ? NextResponse.redirect(checkUrl, 307)
        : NextResponse.next({ request: { headers } });
  if (workbench || (research && legacy))
    response.headers.set("Cache-Control", "no-store");
  if (research && oldSync && request.method === "GET") {
    // Preserve the explicit choice across the old sync page's existing tab links.
    // This routing marker grants no session, vault or API access.
    response.cookies.set("logion_legacy_sync", "1", {
      path: "/app/sync",
      httpOnly: true,
      sameSite: "strict",
      secure: isHttps,
    });
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), publickey-credentials-get=(self)",
  );
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
