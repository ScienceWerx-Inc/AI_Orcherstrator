# syntax=docker/dockerfile:1

FROM node:20-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/

RUN pnpm install --frozen-lockfile --filter @ai-mw/dashboard...

COPY apps/dashboard apps/dashboard

RUN NEXT_STANDALONE=true pnpm --filter @ai-mw/dashboard build

FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=node:node /repo/apps/dashboard/public ./apps/dashboard/public

USER node

EXPOSE 3000

CMD ["node", "apps/dashboard/server.js"]
