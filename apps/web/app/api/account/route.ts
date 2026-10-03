import { NextResponse } from "next/server";
import { identity, body, failure, HttpError } from "../../../lib/server/auth";
import { transaction } from "../../../lib/server/database";
import { adminStorage } from "../../../lib/server/media";
export async function DELETE(request: Request) {
  try {
    const { user } = await identity(request);
    if ((await body(request, 1024)).confirmation !== "DELETE ACCOUNT")
      throw new HttpError(
        400,
        "CONFIRMATION_REQUIRED",
        "Enter the account deletion confirmation.",
      );
    const admin = adminStorage();
    const keys = await transaction(user.id, async (db) =>
      (
        await db.query(
          "SELECT DISTINCT object_key FROM public.media_assets WHERE owner_id=$1",
          [user.id],
        )
      ).rows.map((r) => r.object_key as string),
    );
    for (let i = 0; i < keys.length; i += 100) {
      const { error } = await admin.storage
        .from("recall-media")
        .remove(keys.slice(i, i + 100));
      if (error) throw new Error("Media cleanup failed.");
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error("Account deletion failed.");
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}
