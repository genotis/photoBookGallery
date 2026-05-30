# 06. REST API 명세 (초안)

기본 prefix: `/api`. 인증 필요(세션 쿠키). 이미지 스트림 엔드포인트는 HTTP 캐시
헤더(`ETag`, `Cache-Control`) 사용.

> **구현 현황 (단계 3 진행)**
> - ✅ 단계 1: 인증(login/logout/me), 헬스(`/api/health`), 루트(`GET/POST/DELETE /api/roots`,
>   `POST /api/roots/:id/scan`), 아카이브(`GET /api/archives`, `:id`, `:id/entries`),
>   이미지(`:id/cover.webp`, `:id/page/:index`), 작업(`GET /api/jobs`, `:id`).
> - ✅ 단계 2: 아카이브 메타 수정(`PATCH /api/archives/:id`)·일괄편집(`POST /api/archives/batch`),
>   분류 엔티티 CRUD(`/api/countries`, `/api/publishers`, `/api/series`, `/api/tags`, `/api/models`),
>   모델 병합(`POST /api/models/:id/merge`), 통합 검색(`/api/search`),
>   패싯(`/api/facets`), 폴더 트리(`/api/tree`). 목록 API 필터에
>   `country/publisher/series/model/tag/ratingMin` 추가.
> - ✅ 단계 3: 재압축(`POST /api/archives/:id/repack`, `GET /api/archives/:id/repack/:jobId`)
>   — 임시→검증→백업→원자 교체, 표본 디코드 무결성 검증, archiveId 단위 락.
> - ✅ 단계 4(부분): SSE 스트림(`GET /api/jobs/stream`, 필터 `?ids=`), 루트 메타 편집(`PATCH /api/roots/:id`)
>   포함 cron 식 `scanCron` 자동 스캔, 썸네일 캐시 LRU GC(주기적 자동 실행).
> - ⏳ 잔여: 중복 탐지 API, BullMQ/Redis·Postgres·7z·다중 사용자(선택 항목).

## 1. 인증
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 비밀번호/자격 검증, 세션 쿠키 발급 |
| POST | `/api/auth/logout` | 세션 종료 |
| GET  | `/api/auth/me` | 현재 세션 정보 |

## 2. 라이브러리 / 스캔
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET  | `/api/roots` | 등록된 스캔 루트 목록 |
| POST | `/api/roots` | 루트 추가 `{ path, label, readOnly, scanCron }` |
| PATCH | `/api/roots/:id` | 루트 메타 수정 `{ label, readOnly, scanCron }` (cron 식은 5필드, null 로 자동 스캔 해제) |
| DELETE | `/api/roots/:id` | 루트 제거 |
| POST | `/api/roots/:id/scan` | 인덱싱 Job 생성 (전체/증분) |
| GET  | `/api/tree?path=` | 폴더 트리 탐색(브라우징용) |

## 3. 아카이브 목록 / 상세
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/archives` | 목록. 쿼리: `page,limit,sort,order, q, country, publisher, model, series, tag, favorite, ratingMin, format` |
| GET | `/api/archives/random?n=<1-200>` | 랜덤 N개. SQLite `ORDER BY RANDOM()`, 매 호출 다른 결과. 좌측 사이드바 "랜덤" 메뉴용. `missing` 자동 제외 |
| GET | `/api/archives/:id` | 상세(메타 + 페이지수 + 표지) |
| PATCH | `/api/archives/:id` | 메타 수정 `{ countryId, publisherId, seriesId, modelIds[], tagIds[], rating, favorite, note, publishedAt, coverEntry }` |
| POST | `/api/archives/batch` | 일괄 편집 `{ ids[], set:{...}, addTags[], removeTags[] }` |
| GET | `/api/archives/:id/entries` | 정렬된 엔트리(페이지) 목록 |
| GET | `/api/archives/:id/suggestions` | 파일명 휴리스틱 파서 결과 (국가/출판사/모델 후보, 기존 엔티티 매칭) |
| POST | `/api/auto-tag/preview` | 일괄 추정 미리보기 `{ onlyMissing?, sampleLimit? }` — 카운트 + 샘플 |
| POST | `/api/auto-tag/apply` | 일괄 적용 Job 생성 `{ ids?, onlyMissing? }` — 새 모델/출판사/국가 자동 생성, 비어있는 필드만 채움. 결과 통계는 Job `payload.stats` 에 기록 |
| POST | `/api/duplicates/scan` | 모든 LibraryRoot 하위 파일을 해시별로 그룹화. 캐시된 contentHash 재사용. Job 으로 진행. |
| GET | `/api/duplicates/latest` | 최근 완료된 중복 스캔 결과 (없으면 `null`) |
| POST | `/api/search/rebuild` | FTS5 인덱스 전체 재구축. 일반적으로 부팅 시 인덱스가 비어있으면 자동 빌드. |

### 목록 응답 예
```json
{
  "items": [
    { "id": 12, "fileName": "...", "title": null, "format": "cbz", "pageCount": 84,
      "contentHash": "<BLAKE3 hex>",
      "hasCover": true,
      "models": [{ "id": 3, "name": "..." }],
      "publisher": { "id": 1, "name": "..." },
      "favorite": true, "rating": 4, "missing": false }
  ],
  "total": 5321, "page": 1, "limit": 60
}
```

`contentHash` 가 응답에 포함된다 — 클라이언트는 이미지 URL 에 이 값을 `?v=…`
버스터로 부착해 "URL = 콘텐츠 주소" 가 되도록 한다. 재압축으로 콘텐츠가 바뀌면
URL 도 바뀌어 브라우저 캐시(immutable) 가 자연스럽게 우회된다.

## 4. 이미지 스트리밍 (갤러리/뷰어)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/archives/:id/cover.webp` | 표지 썸네일(캐시) |
| GET | `/api/archives/:id/page/:index?size=` | 페이지 이미지. `size=thumb\|preview\|full` |
| GET | `/api/archives/:id/page-by-entry?name=&size=` | 엔트리명 직접 지정 |

- `size=thumb`: 작은 WebP(그리드), `preview`: 화면맞춤 리사이즈, `full`: 원본.
- 클라이언트가 모든 이미지 URL 에 `?v=<contentHash 앞 12자>` 를 부착한다 →
  "URL = 콘텐츠 주소" 가 되므로 응답은 `Cache-Control: private, max-age=31536000, immutable`
  로 최대 효율 캐시. 재압축 시 contentHash 가 바뀌어 URL 도 자동으로 회전,
  옛 캐시 응답은 자연스럽게 우회. ETag 는 보조용(콘텐츠해시:엔트리명:사이즈 기반).
- 재압축 종료 직전 서버가 옛 contentHash 키의 디스크 캐시 파일을 즉시 제거
  ([`ThumbnailService.purgeArchiveCache`](../server/src/images/thumbnail.service.ts))
  — LRU 회수를 기다리지 않고 도달 불가 캐시를 회수.

## 5. 편집 (삭제 + 재압축)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/archives/:id/repack` | `{ excludeEntries: string[] }` → Repack Job 생성 |
| GET | `/api/archives/:id/repack/:jobId` | 재압축 작업 상태 |

- 응답: `{ jobId, status }`. 완료 시 갱신된 아카이브 정보(새 path/format/contentHash) +
  백업본 경로 반환.
- 동작(고정 정책): **원본을 백업 경로로 보관 → 활성 위치를 새 `.cbz`로 교체.**
  메타데이터는 새 contentHash로 승계. RAR/CBR 원본은 결과가 항상 `.cbz`.

## 6. 모델 / 출판사 / 분류 엔티티
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/models` | 모델 목록/생성. 쿼리 검색, 별칭 포함 |
| GET/PATCH/DELETE | `/api/models/:id` | 상세/수정/삭제(별칭, 프로필) |
| POST | `/api/models/:id/merge` | 중복 모델 병합 `{ intoId }` |
| GET/POST | `/api/publishers` , `/api/publishers/:id` | 출판사/제작주체 |
| GET/POST | `/api/countries`, `/api/series`, `/api/tags` | 보조 분류 |

## 7. 검색 / 패싯
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/search?q=` | 통합 검색 — fileName/title/note 는 FTS5(트리그램), model/alias/tag 는 LIKE. 3자 미만 토큰은 LIKE 폴백. |
| GET | `/api/facets?...` | 현재 필터 기준 패싯 카운트(모델/출판사/국가/태그). q 필터도 동일 FTS5 경로. |
| POST | `/api/search/rebuild` | FTS5 인덱스 전체 재구축. |

`/api/archives?q=` 도 동일 FTS5 경로로 처리. ArchiveFts 가상 테이블은
`Archive` 의 fileName/title/note 만 인덱싱하며 동기화는 어플리케이션 레이어
(SearchIndexService.reindex)에서 수행한다. 부팅 시 인덱스가 비어있고
Archive 가 존재하면 자동으로 재구축한다.

## 8. 작업(Jobs)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/jobs` | 작업 목록/상태 |
| GET | `/api/jobs/:id` | 단일 작업 상태 |
| GET | `/api/jobs/stream` | SSE 스트림. `?ids=1,2` 로 필터. 접속 직후 스냅샷 push, 이후 변경 시마다 push, 15초 heartbeat. |

## 9. 공통 규약
- 에러: `{ statusCode, message, error }` (Nest 기본 + 필터).
- 페이지네이션: `page`(1-base) + `limit`, 응답에 `total`.
- 정렬: `sort=name|mtime|pageCount|rating|createdAt`, `order=asc|desc`.
- 모든 파일 경로 입력은 서버에서 루트 화이트리스트로 검증.
