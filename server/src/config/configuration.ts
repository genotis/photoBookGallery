export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  auth: {
    password: process.env.PBG_AUTH_PASSWORD ?? '',
  },
  session: {
    secret: process.env.PBG_SESSION_SECRET ?? 'dev-insecure-secret',
  },
  backupDir: process.env.PBG_BACKUP_DIR ?? '/app/backups',
  cacheDir: process.env.PBG_CACHE_DIR ?? './cache',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // 동시 이미지 렌더(압축풀기+sharp) 상한. 브라우저 병렬 요청+프리페치가 몰려도
  // 이 수만큼만 실제로 처리해 CPU 포화를 막는다. 0/미설정이면 코어수-1(최소 2).
  imageConcurrency: parseInt(process.env.PBG_IMAGE_CONCURRENCY ?? '0', 10),
  // 고우선(보이는 페이지) 전용으로 남길 렌더 슬롯 수. 프리페치가 동시성을 다
  // 먹어도 현재 페이지가 즉시 실행되도록 예약. 0=예약 없음(옛 동작).
  imageReserveHigh: parseInt(process.env.PBG_IMAGE_RESERVE_HIGH ?? '1', 10),
});
