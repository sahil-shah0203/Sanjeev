import { NextResponse } from "next/server";
import { identity, body, failure } from "../../../../lib/server/auth";
import { push } from "../../../../lib/server/sync";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { user } = await identity(request);
    return NextResponse.json(await push(user.id, await body(request)));
  } catch (e) {
    return failure(e);
  }
}
