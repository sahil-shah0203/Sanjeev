import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({
    adaptive: process.env.ENABLE_ADAPTIVE_PRACTICE === "true",
    generation: process.env.ENABLE_AI_GENERATION === "true",
    sourcePractice:
      process.env.ENABLE_SOURCE_PRACTICE === "true" &&
      process.env.ENABLE_AI_GENERATION === "true" &&
      process.env.ENABLE_ADAPTIVE_PRACTICE === "true",
    provider:
      process.env.LLM_PROVIDER === "openai"
        ? "OpenAI"
        : "the synthetic fixture provider",
  });
}
