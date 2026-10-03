import { NextResponse } from "next/server";
import { identity, failure, HttpError } from "../../../../lib/server/auth";
import { pull } from "../../../../lib/server/sync";
export async function GET(request: Request) {
  try {
    const { user } = await identity();
    const params = new URL(request.url).searchParams;
    const cursor = Number(params.get("cursor") ?? 0),
      limit = Math.min(100, Number(params.get("limit") ?? 100));
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      !Number.isInteger(limit) ||
      limit < 1
    )
      throw new HttpError(400, "INVALID_CURSOR", "Invalid sync cursor.");
    return NextResponse.json(await pull(user.id, cursor, limit));
  } catch (e) {
    return failure(e);
  }
}
