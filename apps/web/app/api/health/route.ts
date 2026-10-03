import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json(
    { status: "ok", app: "recall", schemaVersion: 1 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
