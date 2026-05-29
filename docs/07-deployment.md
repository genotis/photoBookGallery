# 07. 배포 (Synology Container Manager)

## 1. 배포 형태

**2-컨테이너 구성:** 앱(NestJS + SPA + SQLite) + Redis(작업 큐).
DB는 SQLite 파일 한 개. 큐는 Redis 가 백엔드.

```
[Synology Container Manager > 프로젝트]
  photobookgallery (앱 컨테이너)
    ├─ NestJS API (컨테이너 3000 → 호스트 8021) ─── DSM 리버스 프록시 권장
    ├─ SQLite + FTS5 (/app/data)
    └─ 썸네일 캐시 (/app/cache)

  pbg-redis (작업 큐 백엔드)
    └─ AOF 영속화 (/data)

  볼륨 마운트:
    /volume1/photobooks            → /media/photobooks   (RW: 편집 허용)
    /volume1/docker/pbg/backups    → /app/backups        (편집 시 원본 백업)
    /volume1/docker/pbg/data       → /app/data
    /volume1/docker/pbg/cache      → /app/cache
    /volume1/docker/pbg/redis      → /data               (Redis AOF)
```

## 2. 사전 준비 (NAS)

### 2.1 폴더 만들기 (File Station)
```
/volume1/docker/pbg/
  ├── backups/
  ├── data/
  ├── cache/
  └── redis/
```

### 2.2 DSM 사용자/그룹 ID 확인 (SSH)
컨테이너 내부에서 NAS 파일을 읽고 쓰려면 호스트 사용자 UID/GID 를 컨테이너에
주입해야 한다. SSH 로 NAS 접속 후:
```sh
id admin     # uid=1026(admin) gid=100(users) groups=...
# 또는 본인 계정으로
id $(whoami)
```
출력된 `uid` / `gid` 를 다음 단계의 `PUID` / `PGID` 에 사용한다.

### 2.3 미디어 폴더 권한
컨테이너 사용자가 미디어 폴더를 RW 로 접근해야 재압축이 동작한다.
DSM > 제어판 > 공유 폴더 > photobooks > 권한 탭에서 해당 사용자에
**읽기/쓰기** 권한 부여.

## 3. 이미지 준비

### 3.1 권장: 로컬에서 빌드 후 NAS 로 전송 (registry 불요)
```sh
# 로컬(개발 머신, x86_64 가정)
docker build -t photobookgallery:latest .

# NAS 모델이 ARM 이면 buildx 멀티아키:
docker buildx build --platform linux/amd64,linux/arm64 \
  -t photobookgallery:latest --load .

# tar 로 저장 → NAS 업로드 → Container Manager 에서 import
docker save photobookgallery:latest | gzip > pbg.tar.gz
scp pbg.tar.gz admin@nas:/volume1/docker/pbg/
```

NAS 측 (SSH):
```sh
sudo docker load < /volume1/docker/pbg/pbg.tar.gz
```

### 3.2 대안: NAS 에서 직접 빌드
저장소 클론 후 Container Manager > 프로젝트 > **생성 > 소스 코드** 로 빌드.

## 4. Container Manager 프로젝트 생성

### 4.1 프로젝트 생성 흐름
1. **Container Manager > 프로젝트 > 생성**
2. 프로젝트 이름: `photobookgallery`
3. 경로: `/volume1/docker/pbg`
4. 소스: **docker-compose.yml 생성** 선택
5. 아래 YAML 붙여넣기 (저장소의 [docker-compose.yml](../docker-compose.yml) 기반):

```yaml
services:
  pbg:
    image: photobookgallery:latest
    container_name: photobookgallery
    ports:
      - "8021:3000"   # NAS 호스트 8021 노출
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/pbg.db
      - PBG_AUTH_PASSWORD=___반드시_변경___
      - PBG_SESSION_SECRET=___긴_랜덤_문자열___
      - PBG_BACKUP_DIR=/app/backups
      - PBG_CACHE_DIR=/app/cache
      - PBG_CACHE_MAX_MB=2048
      - REDIS_URL=redis://redis:6379
      - PUID=1026   # 2.2 단계에서 확인한 uid
      - PGID=100    # 2.2 단계에서 확인한 gid
      - TZ=Asia/Seoul
    volumes:
      - /volume1/photobooks:/media/photobooks
      - /volume1/docker/pbg/backups:/app/backups
      - /volume1/docker/pbg/data:/app/data
      - /volume1/docker/pbg/cache:/app/cache
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: pbg-redis
    command: ["redis-server", "--appendonly", "yes", "--save", ""]
    volumes:
      - /volume1/docker/pbg/redis:/data
    restart: unless-stopped
```

6. 검토 > **다음** > 빌드 단계는 이미지를 이미 import 했으면 스킵.
7. 프로젝트 시작.

### 4.2 첫 기동 확인
- Container Manager > 컨테이너 > `photobookgallery` 상태가 **실행 중 ✓** 인지 확인
- 헬스체크가 ✓ 로 바뀌기까지 ~20초 정도 소요 (Prisma migrate + Nest 부팅)
- 컨테이너 로그에서 `Nest application successfully started` 확인
- `Redis 연결됨` 로그가 같이 나오는지 확인

## 5. 외부 접속 — DSM 리버스 프록시

직접 포트(8021) 노출 대신 DSM 리버스 프록시로 HTTPS 종단을 권장.

1. **제어판 > 로그인 포털 > 고급 > 역방향 프록시 > 생성**
2. 소스: `https://photobooks.example.com` (서브도메인 + Let's Encrypt 인증서)
3. 대상: `http://localhost:8021`
4. 사용자 정의 헤더: `WebSocket` 헤더 활성화 (SSE 가 동작하도록 `Upgrade`/`Connection` 헤더 전달)
5. 가능하면 추가로 Tailscale/WireGuard 뒤에 두기를 권장. 앱 자체는 단일
   비밀번호 인증만 제공한다.

## 6. PUID/PGID 가 잘못됐을 때

증상:
- 인덱싱은 되지만 **재압축 실패: 권한 거부**
- `/app/data/pbg.db` 쓰기 실패

해결:
1. NAS SSH 에서 `id <사용자>` 로 정확한 uid/gid 확인
2. Container Manager > 컨테이너 > photobookgallery > 환경 변수에서
   `PUID`/`PGID` 수정 후 재시작
3. 그래도 안 되면 NAS 측 폴더 소유권 조정:
   ```sh
   sudo chown -R 1026:100 /volume1/docker/pbg
   ```

## 7. 백업

- **백업 대상**: `/volume1/docker/pbg/data/pbg.db` (DB) — 메타데이터·태그·평점.
- 미디어 원본은 NAS 기존 백업 정책(Hyper Backup 등)에 위임.
- Redis(`/volume1/docker/pbg/redis`) 는 백업 불요 — 큐 상태는 휘발 가능.
- 썸네일 캐시(`/volume1/docker/pbg/cache`) 는 재생성 가능 → 백업 불요.
- 가장 단순한 방법: Container Manager 에서 컨테이너 일시 정지 → `pbg.db` 파일을
  Hyper Backup 작업에 포함 → 재개. 핫 백업이 필요하면 SQLite `VACUUM INTO`.

## 8. 업데이트

1. 새 이미지 import (3.1 절)
2. Container Manager > 프로젝트 > photobookgallery > **빌드/재배포**
3. 자동으로 Prisma 마이그레이션 적용 (엔트리포인트의 `migrate deploy`)

## 9. 리소스 / 운영

- 인덱싱/썸네일 생성은 CPU/IO 집약. NAS 사양에 따라 동시 워커 1개 권장(현재 기본).
- 초기 대량 스캔은 야간 등 한가한 시간에 자동 실행 — 설정에서 cron 식 지정.
- 캐시는 `PBG_CACHE_MAX_MB` (기본 2048MB) 한도로 자동 LRU eviction.
- 헬스체크: `GET /api/health` (Container Manager UI 상태 인디케이터에 반영).

## 10. 트러블슈팅

| 증상 | 원인/해결 |
|------|----------|
| 첫 기동에서 헬스체크 실패 | Prisma migrate 가 길게 걸릴 수 있음. 30초 더 기다린 뒤 로그 확인. |
| `Redis 연결 오류` 반복 | redis 컨테이너가 안 떠 있거나, 같은 docker-compose 네트워크 밖. 동일 프로젝트에 함께 정의했는지 확인. |
| 재압축 시 "원본 백업 실패: EXDEV" | 백업 경로와 미디어 경로가 다른 파티션이라 rename 불가. 자동으로 copy+unlink 폴백되지만 시간이 더 걸림. 같은 볼륨 권장. |
| 모바일/iPad 에서 표지가 비어보임 | 헬스체크는 정상인데 정적 SPA 가 안 보임 → 빌드 단계가 누락. 이미지를 재빌드. |
| 인덱싱이 새 파일을 못 잡음 | NAS Antivirus 가 새 파일을 임시 잠그는 케이스. 미디어 폴더를 백신 예외에 추가. |
