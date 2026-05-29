# 03. 기술 스택 선정

## 1. 결론 요약

| 영역 | 선택 | 비고 |
|------|------|------|
| 백엔드 | **NestJS (TypeScript)** | 사용자 선호 + 모듈/DI 구조가 본 도메인에 적합 |
| ORM/DB 접근 | **Prisma** | 타입 안전, 마이그레이션, SQLite↔Postgres 전환 용이 |
| DB | **SQLite(better-sqlite3) 기본**, 확장 시 PostgreSQL | NAS 단일 컨테이너 운영 단순화 |
| 작업 큐 | **단계 1: 인메모리(@nestjs/bull 없이 자체)**, 확장 시 BullMQ+Redis | Redis 추가 컨테이너 회피 |
| 이미지 처리 | **sharp** | 고성능 리사이즈/WebP 변환 |
| 내용 해시 | **BLAKE3** 또는 **xxHash64** | 아카이브 식별키. SHA-256보다 수 배 빠름 |
| ZIP 읽기 | **node-stream-zip** | 스트리밍 엔트리 읽기 |
| ZIP 쓰기 | **yazl** 또는 **archiver** | 재압축(저장) |
| RAR 읽기 | **node-unrar-js** (WASM) | 읽기 전용, 네이티브 의존성 없음 |
| 프론트엔드 | **React + Vite + TypeScript** | 갤러리 생태계(라이브러리) 풍부 |
| 상태/데이터 | **TanStack Query** | 서버 상태 캐싱/프리패치 |
| 그리드 | **masonic** 또는 react-virtuoso | 가상 스크롤 메이슨리 |
| 뷰어 | **PhotoSwipe** (또는 자체 구현) | 줌/스와이프/라이트박스 |
| UI | **Tailwind CSS + (shadcn/ui 등)** | 빠른 구축 |
| 인증 | 세션 쿠키 + Guard (단계 1: 단일 비밀번호) | 외부 노출 대비 최소 게이트 |

## 2. 백엔드: 왜 NestJS인가
- 도메인이 명확히 모듈화됨(Library/Archive/Gallery/Metadata/Jobs) → Nest의
  모듈/프로바이더/DI 구조와 잘 맞음.
- 가드/인터셉터/파이프로 인증·검증·로깅을 횡단 관심사로 깔끔히 분리.
- 스트리밍 응답(`StreamableFile`), 정적 서빙(`ServeStaticModule`) 기본 지원 →
  이미지 스트리밍과 SPA 호스팅을 한 프로세스에서 처리 가능.

### 대안 비교 (참고)
- **Fastify(plain)**: 더 가볍고 빠르지만 구조/규약은 직접 설계. 본 프로젝트는
  도메인 모듈이 많아 Nest의 구조적 이점이 더 큼. (Nest는 Fastify 어댑터도 지원.)
- **Go/Rust**: 아카이브 처리/동시성 성능은 우수하나 개발 속도·생태계(특히 RAR
  읽기 라이브러리, 이미지 처리)에서 Node가 유리. 단일 사용자 규모엔 과함.
- 결론: **NestJS 유지**. 단, RAR 처리에서 WASM unrar로도 부족하면 컨테이너에
  `unrar`/`7z` 바이너리를 두고 child_process로 호출하는 옵션을 보조로 둔다.

## 3. DB 선택: SQLite vs PostgreSQL

| 기준 | SQLite | PostgreSQL |
|------|--------|------------|
| 운영 부담 | 파일 1개, 컨테이너 0개 추가 | 별도 컨테이너/볼륨/백업 |
| 동시 쓰기 | 약함(직렬화) — 단일 사용자엔 충분 | 강함 |
| 규모 | 수만 행 문제없음 | 수십만+ 유리 |
| 전문검색 | FTS5 내장 | 강력(pg_trgm 등) |
| 마이그레이션 | Prisma로 Postgres 전환 용이 | — |

→ **초기 SQLite + Prisma**. 인덱싱 규모가 커지고 동시성/검색 요구가 커지면
Postgres로 승격(Prisma 스키마 provider만 교체 + 마이그레이션).

## 4. 작업 큐: Redis를 쓸 것인가
- NAS에 컨테이너를 늘리지 않으려면 **단계 1은 인메모리 큐**(간단한 동시성 제한
  워커)로 충분. 인덱싱/썸네일/재압축은 재시작 시 재개 가능하도록 DB에 작업 상태 기록.
- 작업량/신뢰성 요구가 커지면 **BullMQ + Redis 컨테이너**로 승격.

## 5. 프론트엔드: 갤러리 강화 관점
- **그리드**: 수천 썸네일을 끊김 없이 보려면 가상 스크롤 필수(`masonic`/virtuoso).
- **뷰어**: PhotoSwipe 기반 + 더블페이지/연속스크롤 모드는 커스텀 레이어로 확장.
- **프리로딩**: 현재 페이지 ±N을 미리 fetch(브라우저 캐시/HTTP 캐시 헤더 활용).
- **이미지 포맷**: 썸네일은 WebP(용량/속도), 원본 뷰는 원본 또는 고품질 리사이즈.

## 6. 핵심 의존성 라이선스/주의
- `node-unrar-js`: unrar 소스 기반(읽기 전용, 재배포 가능). **RAR 생성/수정 불가**.
- 컨테이너에 `rar`(독점) 바이너리를 넣어 RAR 쓰기를 구현하는 것은 **라이선스상
  배포 부적합** → 채택하지 않음. RAR 편집은 ZIP 재패키징으로 우회([04 참조]).
- `sharp`: prebuilt 바이너리. 멀티아키(amd64/arm64) 이미지 빌드 시 플랫폼 확인.

[04 참조]: 04-archive-handling.md
