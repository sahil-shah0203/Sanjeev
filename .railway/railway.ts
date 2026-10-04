import { defineRailway, project, service, preserve } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "recall-worker";

export default defineRailway(() => {
  const recall_worker = service("recall-worker", {
    healthcheck: "/healthz",
    healthcheckTimeout: 120,
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.worker" },
    env: {
      DATABASE_URL: preserve(), ENABLE_AI_GENERATION: preserve(),
      LLM_API_KEY: preserve(), LLM_DAILY_SPEND_LIMIT: preserve(),
      LLM_INPUT_USD_PER_MILLION: preserve(), LLM_OUTPUT_USD_PER_MILLION: preserve(),
      LLM_MODEL: preserve(), LLM_PROVIDER: preserve(), NODE_ENV: preserve(),
    },
  });
  return project("recall-beta", {
    resources: [recall_worker],
  });
});
