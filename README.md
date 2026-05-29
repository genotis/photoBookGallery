# photoBookGallery

시놀로지 NAS에 보관된 사진집/그라비아 압축 파일(`.zip` / `.cbz` / `.cbr` / `.rar`)을
**압축 해제 없이** 브라우징·정리·갤러리 뷰잉하기 위한 셀프호스팅 웹 애플리케이션.

- **실행 환경**: Synology NAS (Docker / Container Manager)
- **백엔드**: NestJS (TypeScript)
- **프론트엔드**: React + Vite (갤러리 중심 SPA)
- **주 콘텐츠**: 일본 그라비아 사진집 (모델 중심 분류)
- **분류 축**: 국가 / 출판사(제작주체) / 모델 / 시리즈 / 태그

## 문서

개발에 착수하기 전, 아래 설계 문서를 먼저 검토하세요.

| 문서 | 내용 |
|------|------|
| [docs/01-requirements.md](docs/01-requirements.md) | 요구사항 정의 (기능/비기능/범위) |
| [docs/02-architecture.md](docs/02-architecture.md) | 시스템 아키텍처, 모듈 구성, 데이터 흐름 |
| [docs/03-tech-stack.md](docs/03-tech-stack.md) | 기술 스택 선정 근거와 대안 비교 |
| [docs/04-archive-handling.md](docs/04-archive-handling.md) | **(핵심)** 압축파일 읽기/편집/재압축 전략, CBR 제약 |
| [docs/05-data-model.md](docs/05-data-model.md) | 도메인 모델 / DB 스키마 |
| [docs/06-api.md](docs/06-api.md) | REST API 명세 |
| [docs/07-deployment.md](docs/07-deployment.md) | Docker / Synology 배포 가이드 |
| [docs/08-roadmap.md](docs/08-roadmap.md) | 단계별 개발 로드맵 (MVP → 확장) |

## 핵심 의사결정 요약 (TL;DR)

1. **파일을 단일 진실 원천(Source of Truth)으로 둔다.** NAS의 압축파일이 원본이고,
   DB는 인덱스/캐시/사용자 메타데이터만 보관한다. DB가 날아가도 재스캔으로 복구 가능.
2. **내용 해시로 식별한다.** 아카이브 식별키는 경로가 아니라 **내용 전체 해시**
   (BLAKE3/xxHash64). 파일을 옮기거나 이름을 바꿔도 메타데이터(모델/태그/평점)가 유지된다.
   해시는 1회 계산 후 `(크기,mtime)`로 캐시.
3. **압축 해제 없이 스트리밍 읽기.** ZIP/CBZ는 `node-stream-zip`, RAR/CBR은
   `node-unrar-js`(WASM)로 엔트리 단위 온디맨드 추출 + 썸네일 캐시.
4. **CBR(RAR) 편집은 CBZ(ZIP)로 변환하여 처리한다.** RAR 포맷 쓰기는 오픈소스로
   불가능하므로, "개별 파일 삭제 후 재압축"은 **항상 ZIP으로 재패키징**한다.
   **원본은 백업 경로로 보관한 뒤 활성 위치를 새 ZIP으로 교체**한다.
   자세한 근거는 [docs/04-archive-handling.md](docs/04-archive-handling.md) 참조.
5. **단일 사용자.** 인증은 단일 비밀번호 게이트. 배포는 **단일 컨테이너 + SQLite**로
   NAS 운영 부담을 최소화한다.
