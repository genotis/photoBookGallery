# 02. 시스템 아키텍처

> **작업 큐** — 모든 백그라운드 작업은 BullMQ + Redis 큐를 거친다.
> DB `Job` 테이블은 UI/SSE 의 단일 진실 원천이고, 큐는 영속화 + stalled 복구 +
> 동시성 제어를 담당. BullMQ jobId 는 `pbg-{Job.id}` 형식으로 DB 와 1:1 매핑되며
> 중복 enqueue 도 차단된다. 부팅 시 `JobReconcilerService` 가 고아 Job 을
> `failed` 로 마감한다. Redis 는 docker-compose 의 동거 서비스.

## 1. 설계 원칙

1. **파일이 단일 진실 원천(Source of Truth).** NAS의 압축파일이 원본 데이터.
   DB는 인덱스 + 캐시 + 사용자 메타데이터일 뿐, 삭제되어도 재스캔으로 복구 가능.
2. **읽기는 비파괴(non-destructive).** 브라우징/뷰잉은 원본을 절대 변경하지 않음.
3. **쓰기는 원자적(atomic).** 편집/재압축은 임시 파일 → 검증 → 원자적 교체.
4. **무거운 작업은 비동기 큐로.** 인덱싱·썸네일 생성·재압축은 백그라운드 작업.
5. **캐시 우선.** 썸네일과 엔트리 목록은 적극적으로 캐시.

## 2. 컴포넌트 구성

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                          │
│   - 라이브러리 그리드 / 분류 탐색 / 뷰어(라이트박스) / 편집 UI    │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS (REST + 이미지 스트림)
┌───────────────▼──────────────────────────────────────────────┐
│  NestJS 백엔드 (단일 컨테이너)                                  │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ HTTP API     │  │ Auth/Guard   │  │ Static (SPA 서빙)   │   │
│  └──────┬───────┘  └──────────────┘  └────────────────────┘   │
│         │                                                      │
│  ┌──────▼─────────────────────────────────────────────────┐   │
│  │ 도메인 모듈                                              │   │
│  │  Library · Archive · Gallery · Metadata · Model ·       │   │
│  │  Publisher · Editing · Search                           │   │
│  └──────┬───────────────────────────┬─────────────────────┘   │
│         │                           │                          │
│  ┌──────▼────────┐          ┌───────▼──────────┐               │
│  │ Archive       │          │ Jobs (Queue)     │               │
│  │ Adapter Layer │          │  - Indexer       │               │
│  │  - ZipAdapter │          │  - Thumbnailer   │               │
│  │  - RarAdapter │          │  - Repacker      │               │
│  │  (read/write) │          └───────┬──────────┘               │
│  └──────┬────────┘                  │                          │
│         │                           │                          │
│  ┌──────▼───────────────────────────▼──────────┐              │
│  │ Storage 계층                                  │              │
│  │  - DB (SQLite/Postgres): 인덱스·메타·작업상태  │              │
│  │  - Thumbnail Cache (디스크)                   │              │
│  │  - Media FS (NAS 볼륨, RO/RW 마운트)          │              │
│  └───────────────────────────────────────────────┘            │
└────────────────────────────────────────────────────────────────┘
                │ 볼륨 마운트
┌───────────────▼──────────────────────────────────────────────┐
│  Synology NAS 파일시스템                                       │
│   /volume1/photobooks/...  (압축파일 원본)                     │
│   /volume1/docker/photobookgallery/{data,cache,config}         │
└────────────────────────────────────────────────────────────────┘
```

## 3. 백엔드 모듈 (NestJS)

| 모듈 | 책임 |
|------|------|
| `LibraryModule` | 루트 경로 등록, 폴더 트리 탐색, 스캔 트리거 |
| `ArchiveModule` | 아카이브 메타(엔트리 목록) 조회, 어댑터 라우팅 |
| `ArchiveAdapter` | 포맷별 읽기/쓰기 추상화 (Zip/Rar). 아래 4절 참조 |
| `GalleryModule` | 썸네일/원본 이미지 스트리밍, 페이지 순서 정렬, 프리로딩 힌트 |
| `MetadataModule` | 아카이브 메타데이터(국가/태그/평점/즐겨찾기/메모) CRUD |
| `ModelModule` | 모델(인물) 엔티티, 별칭, 프로필, 아카이브-모델 다대다 |
| `PublisherModule` | 출판사/제작주체 엔티티 |
| `EditingModule` | 엔트리 삭제 + 재패키징(재압축) 작업 생성 |
| `SearchModule` | 통합 검색(파일명/메타/모델/태그), 패싯 필터 |
| `JobsModule` | 비동기 작업 큐(인덱싱/썸네일/재압축) + 진행상황 |
| `AuthModule` | 인증/세션 가드 |

## 4. Archive Adapter 계층 (핵심 추상화)

포맷별 차이를 인터페이스 뒤로 숨긴다. 읽기는 모든 포맷 지원, **쓰기는 ZIP만**.

```ts
interface ArchiveReader {
  listEntries(archivePath: string): Promise<ArchiveEntry[]>;     // 압축 해제 없이 목록
  readEntry(archivePath: string, entryName: string): Promise<Buffer | Readable>;
}

interface ArchiveWriter {
  // 지정 엔트리를 제외하고 새 ZIP 생성 (재압축)
  repackExcluding(srcPath: string, excludeEntries: string[], destPath: string): Promise<void>;
}
```

- `ZipReader` / `ZipWriter`: `node-stream-zip`(읽기) + `archiver`/`yazl`(쓰기).
- `RarReader`: `node-unrar-js`(WASM, 읽기 전용).
- `RarWriter`: **존재하지 않음.** RAR 편집 요청은 ZipWriter로 라우팅하여
  결과를 `.cbz`로 산출. 상세 근거: [04-archive-handling.md](04-archive-handling.md).

## 5. 데이터 흐름

### 5.1 인덱싱 (스캔)
```
사용자/스케줄 → Indexer Job
  → 루트 경로 walk
  → 각 파일: (size,mtime) 변동 시 내용 해시 계산(BLAKE3/xxHash64), 아니면 캐시 사용
  → contentHash로 식별: 신규/이동(경로만 갱신)/변경 판별
  → 엔트리 목록 추출 → 이미지 개수/표지 결정 → 파일명 휴리스틱 파싱
  → DB upsert(contentHash 기준, 메타 승계) → 표지 썸네일 생성 Job enqueue
```

### 5.2 갤러리 그리드 표시
```
GET /api/archives?filter... → DB 조회(페이지네이션)
  → 각 항목 표지 썸네일 URL 반환
GET /api/archives/:id/cover.webp → 캐시 적중 시 즉시 반환
  → 미적중 시 어댑터로 표지 추출 → sharp 리사이즈 → 캐시 저장 → 반환
```

### 5.3 뷰어 페이지 열람
```
GET /api/archives/:id/entries → 정렬된 엔트리 목록(JSON)
GET /api/archives/:id/page/:index → 원본/리사이즈 이미지 스트림
  (다음 N페이지 프리로딩은 프론트가 선요청)
```

### 5.4 편집(삭제+재압축)
```
POST /api/archives/:id/repack { excludeEntries[] }
  → Repacker Job:
      1) 임시경로에 새 ZIP 생성(제외 엔트리 빼고 복사)
      2) 무결성 검증(엔트리 수/이미지 디코드 테스트)
      3) 원본을 백업 경로로 이동/복사 후, 활성 위치를 새 .cbz로 교체(atomic rename)
      4) DB 갱신(새 contentHash로 update, 메타 승계) + 썸네일/엔트리 캐시 무효화
  → 작업 상태를 폴링 또는 SSE로 보고
```

## 6. 캐시 전략
- **썸네일 캐시 키**: `hash(archivePath + entryName + mtime + 사이즈프로필)`.
  원본 mtime 변경 시 자동 무효화.
- **엔트리 목록 캐시**: DB에 정규화 저장(아카이브당 1회 추출, 변경 시 갱신).
- **저장 위치**: NAS의 `cache/` 볼륨(컨테이너 재시작에도 유지).
- **용량 관리**: LRU 또는 총량 상한 + 주기적 정리 Job.

## 7. 동시성/안전
- 같은 아카이브에 대한 재압축은 락(파일 단위 mutex)으로 직렬화.
- 미디어 경로는 화이트리스트 + 정규화로 path traversal 차단.
- 편집 RW가 필요한 경로와 RO 브라우징 경로를 마운트/설정에서 분리 가능.
