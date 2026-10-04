import { NextResponse } from "next/server";
import { serverAuth } from "../../../lib/server/auth";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const origin = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  if (code) {
    const client = await serverAuth();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL("/account?connected=1", origin));
  }
  return NextResponse.redirect(new URL("/account?authError=1", origin));
}
