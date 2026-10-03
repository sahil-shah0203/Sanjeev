import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

for (const file of [".env", "apps/web/.env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const cloudOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";
const cloudConnections = cloudOrigin
  ? `${cloudOrigin} ${cloudOrigin.replace(/^http/, "ws")}`
  : "";
const config = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  agentRules: false,
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "production" ? "" : "'unsafe-eval'"} 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self' ${cloudConnections}; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
