# syntax=docker/dockerfile:1.7
# Multi-stage build for RanchApp (Node 22 + better-sqlite3 native build).

# ---------- build stage ----------
FROM node:22-bookworm AS build

# better-sqlite3 v12 ships prebuilds for most platforms; keep python3+make+g++
# as a fallback so the image build never fails on a missing prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY tsconfig.base.json ./

RUN npm install

# Copy sources + build everything.
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Copy only what's needed to run.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./

# The DB lives on a mounted volume in production.
ENV RANCHAPP_DB=/data/ranch.db
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
