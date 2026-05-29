# 08. 개발 로드맵

원칙: **읽기(브라우징+뷰잉)를 먼저 완성**하고, 그 다음 정리(메타데이터),
마지막에 편집(삭제+재압축)을 붙인다. 위험도가 높은 쓰기 기능을 뒤로 미뤄
안전하게 누적한다.

## 단계 0 — 기반 (스캐폴딩)
- [ ] 모노레포 구조: `server/`(NestJS) + `web/`(React+Vite).
- [ ] Prisma + SQLite 연결, 기본 스키마 마이그레이션.
- [ ] Dockerfile(멀티스테이지) + docker-compose, NAS 마운트로 기동 확인.
- [ ] 인증 게이트(단일 비밀번호) + 세션.
- [ ] 헬스체크, 구조적 로깅.

## 단계 1 — MVP: 브라우징 + 갤러리 뷰잉 (읽기 전용)
- [x] LibraryRoot 등록 + 인덱서 Job(경로 walk, 아카이브 탐지, 엔트리 추출).
- [x] ZIP/CBZ 읽기(`node-stream-zip`) + RAR/CBR 읽기(`node-unrar-js`).
      ※ ZIP/CBZ는 E2E 검증 완료. RAR/CBR은 어댑터 구현·연결 완료(실파일 검증은 추후).
- [x] 자연 정렬, 표지 결정, pageCount 산출. (1<2<10 검증)
- [x] 썸네일 파이프라인(sharp + 디스크 캐시 + ETag/304 + 콘텐츠해시 키).
- [x] 아카이브 목록 API + 가상 스크롤 그리드(masonic) + 무한 스크롤.
- [x] 뷰어: 단일/연속 모드, 프리로딩, 키보드 네비게이션. (더블페이지·줌은 단계 4)
- [x] 기본 검색/정렬/페이지네이션 + missing(원본 사라짐) 처리.

**완료 기준**: NAS의 zip/cbz를 풀지 않고 그리드+뷰어로 끊김 없이 감상. ✅
※ 식별은 BLAKE3 콘텐츠 해시 기반(이동/리네임 추적), 증분 스캔(size+mtime 스킵) 검증 완료.

## 단계 2 — 정리(Organize) / 메타데이터
- [x] Model/Publisher/Country/Series/Tag 엔티티 + CRUD.
- [x] 아카이브 메타 편집 UI(모델 다대다, 태그, 평점, 즐겨찾기, 메모).
- [x] 패싯 필터 + 분류축별 탐색(모델/출판사/국가/시리즈/태그). 사이드바에서 토글.
- [x] 모델 병합(중복 정리, 별칭 자동 승계).
- [x] 통합 검색(`/api/search`) — 파일명/메모/모델명/별칭/태그 LIKE 매칭.
- [x] 일괄 편집(`POST /api/archives/batch`) — set/addTags/removeTags/addModels/removeModels.
- [x] 폴더 트리(`/api/tree`) — 루트 화이트리스트 내 폴더별 아카이브 카운트.
- [x] 파일명 휴리스틱 파서(추정→확정 워크플로) — `GET /api/archives/:id/suggestions`. 메타 패널 "파일명에서 추정" 버튼. 선두 숫자 ID/2-3자 ISO 국가코드/모델 후 CJK 별칭 패턴 인식.
- [x] 일괄 태깅 — `POST /api/auto-tag/preview` + `POST /api/auto-tag/apply` (Job). 설정 드로어 "자동 태깅" 섹션, 미리보기 + 적용. 메타 비어있는 항목만 / 전체 토글. 새 엔티티 자동 생성, 기존 채워진 필드는 보존.
- [x] 전문검색(FTS5) — `ArchiveFts` 가상 테이블 + 트리그램 토크나이저. 3자 미만 토큰은 LIKE 폴백. 부팅 시 자동 빌드 + `POST /api/search/rebuild`. 동기화는 indexer/patch/auto-tag/repack 시점에서 호출.

## 단계 3 — 편집(삭제 + 재압축) ⚠ 위험 기능
- [x] 뷰어에서 페이지 선택/삭제 UI (선택 모드 + 단일/연속 보기 모두 지원).
- [x] Repacker Job: ZIP→ZIP 재패키징 (`archiver` STORE, 임시→검증→원자 rename).
- [x] RAR/CBR→CBZ 변환 경로 (RarReader 로 추출 후 ZipWriter 로 패키징, 활성 위치 확장자 `.cbz` 로 교체).
- [x] 저장 정책: 원본 백업(`<backupRoot>/<상대경로>.<timestamp>.<ext>`) 후 활성 위치 교체.
- [x] 파일 락 — `RepackLock` 으로 archiveId 단위 직렬화.
- [x] 무결성 검증 — 엔트리 수 일치 + 마지막 페이지 `sharp().metadata()` 디코드 검증, 실패 시 원본 미변경.
- [ ] 감사 로그 영구화 — 현재 pino 로그만. 별도 테이블/리포트는 후속.

**완료 기준**: 임의 아카이브에서 페이지 삭제 → 안전하게 재압축, 원본 무손실. ✅ (감사 로그 영구화 제외)

## 단계 4 — 강화 / 운영 품질
- [x] 이동/리네임 추적 (단계 1 인덱서에서 `contentHash` 기반 자동 처리, 검증 완료).
- [x] 중복 탐지(해시) — `POST /api/duplicates/scan` + `GET /api/duplicates/latest`. 모든 LibraryRoot 하위를 walk, path+size+mtime 기준 캐시 해시 재사용, 동일 해시 그룹 반환. 설정 드로어에서 트리거.
- [x] 스캔 스케줄링 — `LibraryRoot.scanCron` 필드 + `node-cron` `SchedulerService` (생성/수정/삭제 시 자동 reload).
- [x] 캐시 용량 관리(LRU) — `CacheGcService` 주기 실행, `PBG_CACHE_MAX_MB` 기본 2048MB, atime 오름차순으로 eviction.
- [x] SSE 작업 진행 표시 — `GET /api/jobs/stream` 단일 채널 + 클라이언트 `useJobStream` 훅. 스캔/재압축 모두 SSE 사용, 실패 시 폴링 폴백.
- [x] 반응형/모바일 제스처 — 헤더 토글 가능한 패싯 사이드바, 모바일 가로 폭에서 스택 레이아웃, 뷰어 좌우 스와이프(50px+) 네비게이션.
- [x] BullMQ + Redis — 모든 백그라운드 작업(인덱싱·재압축·자동 태깅·중복 탐지)을 큐로 직렬화. `pbg-{id}` 매핑으로 DB Job 과 1:1. 부팅 시 `JobReconciler` 가 고아 작업을 자동 마감. docker-compose 에 redis 서비스 포함.
- [ ] (선택) 7z 지원.
- [ ] (선택) 다중 사용자/권한.

> **PostgreSQL 승격 — 보류**. 단일 사용자 + 수천~수만 아카이브 규모에선 SQLite + FTS5
> 로 충분하고, 큐는 이미 Redis 로 분리. 다음 조건이 동시에 발생할 때만 재검토:
> 아카이브가 수십만 건 + 패싯/검색 지연, 다중 서비스 DB 접근, 다중 사용자.

## 리스크 & 선제 대응
| 리스크 | 대응 |
|--------|------|
| RAR 편집 불가 | CBZ 재패키징으로 우회(정책 명시) — [04 문서] |
| solid RAR 임의접근 비용 | 표지 우선 + 추출 캐시, 필요 시 unrar 바이너리 |
| 대량 인덱싱 부하 | 워커 수 제한 + 야간 스케줄 + 증분 스캔 |
| 편집 중 데이터 손실 | 임시파일→검증→원자교체 + 원본보존 기본 정책 |
| NAS 권한 충돌 | PUID/PGID, RO/RW 마운트 분리 |
| 외부 노출 보안 | 리버스 프록시 HTTPS + 인증 게이트 + VPN 권장 |

[04 문서]: 04-archive-handling.md
