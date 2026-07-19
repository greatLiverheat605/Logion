import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "web", version: "0.1.0" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
