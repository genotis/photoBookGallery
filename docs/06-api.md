# 06. REST API 명세 (초안)

기본 prefix: `/api`. 인증 필요(세션 쿠키). 이미지 스트림 엔드포인트는 HTTP 캐시
헤더(`ETag`, `Cache-Control`) 사용.

> **구현 현황 (단계 1 완료)**
> - ✅ 구현됨: 인증(login/logout/me), 헬스(`/api/health`), 루트(`GET/POST/DELETE /api/roots`,
>   `POST /api/roots/:id/scan`), 아카이브(`GET /api/archives`, `:id`, `:id/entries`),
>   이미지(`:id/cover.webp`, `:id/page/:index`), 작업(`GET /api/jobs`, `:id`).
> - ⏳ 설계만(단계 2+): 아카이브 메타 수정(PATCH)/일괄편집, 모델·출판사·국가·시리즈·태그
>   CRUD, 모델 병합, 통합 검색/패싯, 재압축(repack), SSE 스트림, 폴더 트리(`/api/tree`).
> - 단계 1 목록 API의 필터는 현재 `q/format/favorite/sort/order/page/limit/includeMissing`만
>   동작. `model/publisher/country/tag` 필터는 단계 2에서 추가.

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
| POST | `/api/roots` | 루트 추가 `{ path, label, readOnly }` |
| DELETE | `/api/roots/:id` | 루트 제거 |
| POST | `/api/roots/:id/scan` | 인덱싱 Job 생성 (전체/증분) |
| GET  | `/api/tree?path=` | 폴더 트리 탐색(브라우징용) |

## 3. 아카이브 목록 / 상세
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/archives` | 목록. 쿼리: `page,limit,sort,order, q, country, publisher, model, series, tag, favorite, ratingMin, format` |
| GET | `/api/archives/:id` | 상세(메타 + 페이지수 + 표지) |
| PATCH | `/api/archives/:id` | 메타 수정 `{ countryId, publisherId, seriesId, modelIds[], tagIds[], rating, favorite, note, publishedAt, coverEntry }` |
| POST | `/api/archives/batch` | 일괄 편집 `{ ids[], set:{...}, addTags[], removeTags[] }` |
| GET | `/api/archives/:id/entries` | 정렬된 엔트리(페이지) 목록 |

### 목록 응답 예
```json
{
  "items": [
    { "id": 12, "fileName": "...", "format": "cbz", "pageCount": 84,
      "coverUrl": "/api/archives/12/cover.webp",
      "models": [{ "id": 3, "name": "..." }],
      "publisher": { "id": 1, "name": "..." },
      "favorite": true, "rating": 4 }
  ],
  "total": 5321, "page": 1, "limit": 60
}
```

## 4. 이미지 스트리밍 (갤러리/뷰어)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/archives/:id/cover.webp` | 표지 썸네일(캐시) |
| GET | `/api/archives/:id/page/:index?size=` | 페이지 이미지. `size=thumb\|preview\|full` |
| GET | `/api/archives/:id/page-by-entry?name=&size=` | 엔트리명 직접 지정 |

- `size=thumb`: 작은 WebP(그리드), `preview`: 화면맞춤 리사이즈, `full`: 원본.
- 응답에 `ETag`(엔트리 해시) + 장기 `Cache-Control`로 프리로딩 효율화.

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
| GET | `/api/search?q=` | 통합 검색(파일명/메모/모델/태그) |
| GET | `/api/facets?...` | 현재 필터 기준 패싯 카운트(모델/출판사/국가/태그) |

## 8. 작업(Jobs)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/jobs` | 작업 목록/상태 |
| GET | `/api/jobs/:id` | 단일 작업 상태 |
| GET | `/api/jobs/stream` | (선택) SSE로 진행상황 푸시 |

## 9. 공통 규약
- 에러: `{ statusCode, message, error }` (Nest 기본 + 필터).
- 페이지네이션: `page`(1-base) + `limit`, 응답에 `total`.
- 정렬: `sort=name|mtime|pageCount|rating|createdAt`, `order=asc|desc`.
- 모든 파일 경로 입력은 서버에서 루트 화이트리스트로 검증.
