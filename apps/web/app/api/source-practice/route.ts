import { NextResponse } from "next/server";
import { z } from "zod";
import { identity, body, failure } from "../../../lib/server/auth";
import { enqueueSourcePractice } from "../../../lib/server/source-practice";
export async function POST(request: Request) {
  try {
    const { user } = await identity(request);
    const input = z
      .object({
        noteId: z.string().uuid(),
        sessionId: z.string().uuid(),
        consent: z.literal(true),
        variant: z.enum([
          "recall",
          "recognition",
          "compare",
          "restate",
          "apply",
          "repair",
        ]),
        reviewId: z.string().uuid().optional(),
      })
      .strict()
      .parse(await body(request, 2048));
    return NextResponse.json(await enqueueSourcePractice(user.id, input), {
      status: 202,
    });
  } catch (e) {
    return failure(e);
  }
}
