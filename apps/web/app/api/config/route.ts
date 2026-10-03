import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({
    adaptive: process.env.ENABLE_ADAPTIVE_PRACTICE === "true",
    generation: process.env.ENABLE_AI_GENERATION === "true",
  });
}
