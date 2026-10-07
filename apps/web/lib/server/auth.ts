import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { id } from "@recall/domain";
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function serverAuth() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    throw new HttpError(
      503,
      "CLOUD_NOT_CONFIGURED",
      "Cloud accounts are not configured on this installation. Local review and native backups are available.",
    );
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (updates) => {
          for (const c of updates) store.set(c.name, c.value, c.options);
        },
      },
    },
  );
}
export async function identity(request?: Request) {
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    const expected = process.env.APP_ORIGIN;
    if (!expected || origin !== new URL(expected).origin)
      throw new HttpError(
        403,
        "INVALID_ORIGIN",
        "This request did not come from the configured app origin.",
      );
  }
  const client = await serverAuth();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new HttpError(
      401,
      "SIGN_IN_REQUIRED",
      "Sign in to sync across devices.",
    );
  return { user: data.user, client };
}
export async function body(request: Request, limit = 2 * 1024 ** 2) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit)
    throw new HttpError(
      413,
      "REQUEST_TOO_LARGE",
      "This request exceeds its size limit.",
    );
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new HttpError(
          413,
          "REQUEST_TOO_LARGE",
          "This request exceeds its size limit.",
        );
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The request was not valid JSON.");
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.status >= 500,
          requestId: id(),
        },
      },
      { status: error.status },
    );
  if (error instanceof Error && error.name === "ZodError")
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "The request did not match the expected schema.",
          retryable: false,
          requestId: id(),
        },
      },
      { status: 400 },
    );
  console.error(
    JSON.stringify({
      event: "server_error",
      name: error instanceof Error ? error.name : "UnknownError",
      code:
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? error.code
          : undefined,
    }),
  );
  return NextResponse.json(
    {
      error: {
        code: "OPERATION_FAILED",
        message:
          "The operation could not complete. Your local data remains saved.",
        retryable: true,
        requestId: id(),
      },
    },
    { status: 500 },
  );
}
