# syntax=docker/dockerfile:1

FROM node:20-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
    && corepack prepare pnpm@10.33.0 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/gateway/package.json apps/gateway/
COPY apps/dashboard/package.json apps/dashboard/

RUN pnpm install --frozen-lockfile --filter @ai-mw/gateway... --filter @ai-mw/contracts...

COPY packages packages
COPY apps/gateway apps/gateway

RUN pnpm --filter @ai-mw/contracts build \
    && pnpm --filter @ai-mw/gateway exec prisma generate \
    && pnpm --filter @ai-mw/gateway build

FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY --from=build --chown=node:node /pnpm /pnpm
COPY --from=build --chown=node:node /repo /repo

USER node
WORKDIR /repo/apps/gateway

EXPOSE 4000

# Migrations are run by the `migrate` compose service (or a Kubernetes init job).
CMD ["node", "dist/main.js"]
