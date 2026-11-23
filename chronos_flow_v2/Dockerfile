# Imagem de producao do Chronos Flow: API + tela no mesmo processo e porta.
# Multi-arquitetura: em servidor ARM (ex.: AWS Graviton) e no Mac com Apple Silicon o build e nativo.

FROM node:22-bookworm-slim AS base
# openssl: o Prisma precisa dele para falar com o Postgres.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- build: cliente (vite) e servidor (tsc)
FROM base AS build
# O Electron e devDependency so do app desktop: aqui nao precisa do binario.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build:client && npm run build:server

# ---- runtime: so dependencias de producao + o CLI do Prisma para as migrations
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3101 \
    HOST=0.0.0.0 \
    CHRONOS_DESCOBERTA=off \
    TZ=America/Sao_Paulo \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm install --no-save "prisma@$(node -p "require('./package.json').devDependencies.prisma")" \
 && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

USER node
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3101/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# As migrations rodam a cada subida: `migrate deploy` so aplica o que falta.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist-server/server/index.js"]
