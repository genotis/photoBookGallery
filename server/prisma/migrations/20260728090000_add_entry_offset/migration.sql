-- 직독(offset-based) 로딩용 ZIP 엔트리 위치 정보.
ALTER TABLE "Entry" ADD COLUMN "method" INTEGER;
ALTER TABLE "Entry" ADD COLUMN "locOffset" BIGINT;
ALTER TABLE "Entry" ADD COLUMN "compSize" BIGINT;
