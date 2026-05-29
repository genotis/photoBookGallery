# syntax=docker/dockerfile:1

# ---- 의존성 설치 (workspace 전체) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

# ---- 프론트엔드 빌드 ----
FROM deps AS web-build
WORKDIR /app
COPY web/ web/
RUN npm run build -w web

# ---- 백엔드 빌드 (Prisma client 생성 + nest build) ----
FROM deps AS server-build
WORKDIR /app
COPY server/ server/
RUN npm run db:generate -w server \
 && npm run build -w server

# ---- 런타임 ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# node_modules 에는 생성된 Prisma client(.prisma) 포함
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/prisma ./server/prisma
COPY --from=server-build /app/server/package.json ./server/package.json
# 빌드된 SPA -> server/public (ServeStaticModule 가 서빙)
COPY --from=web-build /app/web/dist ./server/public

WORKDIR /app/server
EXPOSE 3000
# 시작 시 마이그레이션 적용 후 서버 기동
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
