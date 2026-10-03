import { NextResponse } from "next/server";
import { z } from "zod";
import {
  identity,
  body,
  failure,
  HttpError,
} from "../../../../../lib/server/auth";
import { transaction } from "../../../../../lib/server/database";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await identity(request);
    const { id } = await params;
    const { comment } = z
      .object({ comment: z.string().min(1).max(2000) })
      .parse(await body(request, 4096));
    const result = await transaction(user.id, async (db) =>
      db.query(
        "UPDATE public.documents SET value=value||$3::jsonb,row_version=row_version+1,updated_at=now() WHERE owner_id=$1 AND entity='attempts' AND id=$2 RETURNING id",
        [user.id, id, JSON.stringify({ dispute: comment })],
      ),
    );
    if (!result.rowCount)
      throw new HttpError(
        404,
        "ATTEMPT_MISSING",
        "This attempt was not found.",
      );
    return NextResponse.json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
