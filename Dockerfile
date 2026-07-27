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

ENV NODE_ENV=production \
    PUID=1026 \
    PGID=100 \
    # libuv 스레드풀 확대 — sharp 렌더가 fs 캐시 읽기(같은 풀, 기본 4)를 굶기지
    # 않도록 여유 확보. 렌더 동시성은 앱 내부 스케줄러가 별도로 제한한다.
    UV_THREADPOOL_SIZE=8

# su-exec: PUID/PGID 로 사용자 전환. shadow: usermod/groupmod 제공.
# tini: PID 1 시그널 처리. curl: 헬스체크. openssl: prisma 가 libssl 탐지.
# 7zip: 단일 엔트리 스트리밍 추출(킬 가능). imagemagick(+webp): 리사이즈+webp
# 인코딩을 킬 가능한 서브프로세스로 수행(abort 시 즉시 중단). sharp 는 폴백.
RUN apk add --no-cache su-exec shadow tini curl openssl 7zip \
    imagemagick imagemagick-webp

# node_modules: 루트(호이스트된 의존성) + 서버 workspace(아카이버 등 미호이스트).
# Prisma client(.prisma)는 server-build 단계에서 이미 생성됨.
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/prisma ./server/prisma
COPY --from=server-build /app/server/package.json ./server/package.json
# 빌드된 SPA -> server/public (ServeStaticModule 가 서빙)
COPY --from=web-build /app/web/dist ./server/public

# 엔트리포인트: PUID/PGID 적용 후 비-루트로 실행
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 영속 디렉터리 미리 생성 + node_modules 쓰기 권한.
# PUID/PGID 가 호스트 사용자에 맞춰지면 그 사용자가 prisma engine 캐시/migration 쓰기를 할 수 있어야 한다.
RUN mkdir -p /app/data /app/cache /app/backups \
 && chmod -R a+rwX /app/node_modules/@prisma /app/node_modules/.prisma 2>/dev/null || true \
 && chmod a+rwX /app/data /app/cache /app/backups

WORKDIR /app/server
EXPOSE 3000

# Synology Container Manager 가 상태 인디케이터에 활용
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
