# 07. 배포 (Docker / Synology)

## 1. 배포 형태

**기본: 단일 컨테이너.** NestJS가 API + 정적 SPA를 함께 서빙, DB는 SQLite 파일.
추가 컨테이너(Redis/Postgres)는 확장 시에만.

```
[Synology Container Manager]
  photobookgallery (단일 이미지, multi-stage 빌드)
    ├─ NestJS (port 3000)
    ├─ SQLite (data 볼륨)
    └─ Thumbnail cache (cache 볼륨)
  볼륨 마운트:
    /volume1/photobooks            → /media/photobooks   (RW: 편집 허용)
    /volume1/docker/pbg/backups    → /app/backups        (편집 시 원본 백업 보관)
    /volume1/docker/pbg/data       → /app/data
    /volume1/docker/pbg/cache      → /app/cache
    /volume1/docker/pbg/config     → /app/config
```

## 2. Dockerfile (multi-stage 개요)

```dockerfile
# --- frontend build ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build            # -> /web/dist

# --- backend build ---
FROM node:22-alpine AS api
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate && npm run build   # -> /app/dist

# --- runtime ---
FROM node:22-alpine
WORKDIR /app
# sharp/unrar-js는 네이티브/WASM. 7z 확장 시: RUN apk add --no-cache p7zip
ENV NODE_ENV=production
COPY --from=api  /app/node_modules ./node_modules
COPY --from=api  /app/dist ./dist
COPY --from=api  /app/prisma ./prisma
COPY --from=web  /web/dist ./public        # SPA 정적 파일
EXPOSE 3000
# 시작 시 prisma migrate deploy 후 서버 기동
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

- **멀티아키**: Synology 모델에 따라 amd64/arm64. `docker buildx`로
  `--platform linux/amd64,linux/arm64` 빌드 권장(sharp prebuilt 포함 확인).

## 3. docker-compose (기본)

```yaml
services:
  pbg:
    image: photobookgallery:latest
    container_name: photobookgallery
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/app/data/pbg.db
      - PBG_AUTH_PASSWORD=__change_me__       # 단일 사용자 비밀번호
      - PBG_SESSION_SECRET=__random__
      - PBG_BACKUP_DIR=/app/backups           # 편집 시 원본 백업 경로
      - PUID=1026          # Synology 사용자 uid
      - PGID=100           # users 그룹 gid
      - TZ=Asia/Seoul
    volumes:
      - /volume1/photobooks:/media/photobooks      # 편집 위해 RW
      - /volume1/docker/pbg/backups:/app/backups   # 원본 백업 보관
      - /volume1/docker/pbg/data:/app/data
      - /volume1/docker/pbg/cache:/app/cache
      - /volume1/docker/pbg/config:/app/config
    restart: unless-stopped
```

## 4. Synology 권한 (PUID/PGID)
- 컨테이너가 미디어 파일을 읽고(편집 시 쓰기) NAS 권한과 충돌하지 않도록
  PUID/PGID를 NAS 사용자/그룹에 맞춘다(엔트리포인트에서 chown/su-exec).
- **편집(재압축)** 을 쓰는 경로는 RW로 마운트, 단순 열람만 할 경로는 `:ro`.

## 5. 외부 노출 / 보안
- 직접 포트 노출 대신 **Synology 리버스 프록시(DSM)** 로 HTTPS 종단 + 서브도메인.
- 앱 자체 인증 게이트 필수(단계1: 단일 비밀번호 → 확장: 계정).
- 가능하면 VPN(예: Tailscale/WireGuard) 뒤에 두는 것을 권장.
- path traversal 차단: 미디어 접근은 등록된 루트 화이트리스트 내로만.

## 6. 백업 / 운영
- **백업 대상**: `data/`(SQLite DB = 사용자 메타데이터). cache는 재생성 가능.
- 미디어 원본은 NAS의 기존 백업 정책(Hyper Backup 등)에 위임.
- DB는 SQLite 온라인 백업 또는 컨테이너 정지 후 파일 복사.
- 헬스체크 엔드포인트(`/api/health`)로 컨테이너 상태 감시.

## 7. 리소스 고려
- 인덱싱/썸네일 생성은 CPU/IO 집약 → 동시 워커 수를 NAS 사양에 맞춰 제한.
- 초기 대량 스캔은 야간 등 한가한 시간에 수행 권장(스케줄).
