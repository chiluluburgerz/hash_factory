# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && \
    echo "---- dist listing ----" && \
    ls -la /app && \
    ls -la /app/dist || true && \
    find /app/dist -maxdepth 5 -type f \( -name "server.js" -o -name "index.js" \) -print || true

FROM node:20-alpine AS prod_deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=prod_deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER app
EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:8090/v1/health || exit 1

CMD ["node", "dist/server.js"]