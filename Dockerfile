FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM dependencies AS worker
COPY --chown=node:node . .
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/tsx", "apps/worker/src/main.ts"]
