# syntax=docker/dockerfile:1
#
# Multi-stage build:
#   build   - has dev dependencies + TypeScript, compiles src/ to dist/
#   runtime - only production dependencies + compiled JS. Smaller image, smaller attack surface.

# ---------- build stage ----------
FROM node:24-alpine AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node migrations ./migrations

# Don't run as root inside the container.
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]
