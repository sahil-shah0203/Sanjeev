import { NextResponse } from "next/server";
import { identity, failure, HttpError } from "../../../../lib/server/auth";
import { transaction } from "../../../../lib/server/database";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await identity();
    const { id } = await params;
    const row = await transaction(
      user.id,
      async (db) =>
        (
          await db.query(
            "SELECT id,status,output,error_code,attempts FROM public.jobs WHERE owner_id=$1 AND id=$2",
            [user.id, id],
          )
        ).rows[0],
    );
    if (!row) throw new HttpError(404, "JOB_NOT_FOUND", "Job not found.");
    return NextResponse.json(row);
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await identity(request);
    const { id } = await params;
    await transaction(user.id, (db) =>
      db.query(
        "UPDATE public.jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END WHERE owner_id=$1 AND id=$2 AND status IN ('queued','running')",
        [user.id, id],
      ),
    );
    return NextResponse.json({ cancelled: true });
  } catch (e) {
    return failure(e);
  }
}
