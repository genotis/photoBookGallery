#!/bin/sh
# Synology Container Manager / docker-compose 환경에서
# PUID/PGID 환경변수를 받아 node 사용자에 적용한 뒤 본 명령을 실행한다.
#
# 동작:
#   1) node 사용자의 uid/gid 가 PUID/PGID 와 다르면 usermod/groupmod 로 맞춤
#   2) 영속 디렉터리(/app/data, /app/cache, /app/backups) 소유권 정렬
#   3) su-exec 로 권한 강등 후 CMD 실행
set -e

PUID=${PUID:-1026}
PGID=${PGID:-100}

# 시놀로지 admin 의 기본 uid 가 1026, users 그룹 gid 100.
# 컨테이너 내부의 node 사용자(기본 uid 1000, gid 1000)를 호스트 사용자와 맞춘다.
CURRENT_UID=$(id -u node 2>/dev/null || echo 1000)
CURRENT_GID=$(id -g node 2>/dev/null || echo 1000)

if [ "$CURRENT_GID" != "$PGID" ]; then
  echo "[entrypoint] node gid: $CURRENT_GID -> $PGID"
  groupmod -o -g "$PGID" node 2>/dev/null || true
fi
if [ "$CURRENT_UID" != "$PUID" ]; then
  echo "[entrypoint] node uid: $CURRENT_UID -> $PUID"
  usermod -o -u "$PUID" -g "$PGID" node 2>/dev/null || true
fi

# 영속 마운트 디렉터리 소유권 정렬 (이미 맞으면 빠르게 통과)
for d in /app/data /app/cache /app/backups; do
  if [ -d "$d" ]; then
    chown -R "$PUID:$PGID" "$d" 2>/dev/null || true
  fi
done

# 비-루트로 명령 실행. CMD 가 'sh -c "..."' 형태로 들어오면 그대로 받아 실행.
exec su-exec "$PUID:$PGID" "$@"
