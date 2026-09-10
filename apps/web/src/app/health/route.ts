import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "web",
      version: process.env.LOGION_VERSION?.trim() || "unknown",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
