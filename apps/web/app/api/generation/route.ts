import { NextResponse } from "next/server";
import { z } from "zod";
import { identity, body, failure } from "../../../lib/server/auth";
import { enqueueGeneration } from "../../../lib/server/jobs";
export async function POST(request: Request) {
  try {
    const { user } = await identity(request);
    const input = z
      .object({
        noteId: z.string().uuid(),
        task: z.enum(["recall", "explain", "discriminate", "apply"]),
      })
      .parse(await body(request, 2048));
    return NextResponse.json(
      await enqueueGeneration(user.id, input.noteId, input.task),
      { status: 202 },
    );
  } catch (e) {
    return failure(e);
  }
}
