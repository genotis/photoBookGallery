# 05. 도메인 모델 / DB 스키마

## 1. 엔티티 개요

```
Country 1 ──< Archive >── N Model        (다대다: ArchiveModel)
Publisher 1 ──< Archive                  (한 아카이브 = 한 제작주체, 다대다도 허용 가능)
Series 1 ──< Archive
Archive 1 ──< Entry                       (압축 내 이미지 = 페이지)
Archive 1 ──< Tag (다대다: ArchiveTag)
Archive 1 ──< Thumbnail (캐시 메타)
Job (인덱싱/썸네일/재압축 작업)
LibraryRoot (스캔 루트 경로)
```

- **Archive**: 핵심. 하나의 압축파일 = 하나의 사진집.
- **Model(모델/인물)**: 그라비아 핵심 분류축. 다대다(합본/공동 출연 대응) + 별칭.
- **Publisher(출판사/제작주체)**: 잡지사/스튜디오/이미지 제작주체.
- **Country / Series / Tag**: 보조 분류.
- **Entry**: 아카이브 내 개별 이미지(페이지). 정렬 인덱스 보관.

## 2. Prisma 스키마 (초안)

```prisma
// datasource: SQLite (확장 시 postgresql로 교체)
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
generator client { provider = "prisma-client-js" }

model LibraryRoot {
  id        Int       @id @default(autoincrement())
  path      String    @unique          // NAS 절대경로 (컨테이너 기준)
  label     String?
  readOnly  Boolean   @default(true)    // 편집 허용 여부
  archives  Archive[]
  createdAt DateTime  @default(now())
}

model Archive {
  id           Int       @id @default(autoincrement())
  rootId       Int
  root         LibraryRoot @relation(fields: [rootId], references: [id])
  path         String    @unique        // 현재 파일 경로 (이동 시 갱신됨)
  fileName     String
  format       String                   // zip | cbz | rar | cbr | 7z
  sizeBytes    BigInt
  mtime        DateTime                 // 원본 수정시각(해시/캐시 무효화 키)
  contentHash  String    @unique        // 식별 기준(BLAKE3/xxHash64 전체 해시)
  pageCount    Int       @default(0)
  coverEntry   String?                  // 표지로 쓸 엔트리 이름
  // 분류
  countryId    Int?
  country      Country?  @relation(fields: [countryId], references: [id])
  publisherId  Int?
  publisher    Publisher? @relation(fields: [publisherId], references: [id])
  seriesId     Int?
  series       Series?   @relation(fields: [seriesId], references: [id])
  models       ArchiveModel[]
  tags         ArchiveTag[]
  entries      Entry[]
  // 사용자 메타
  publishedAt  DateTime?
  rating       Int?                     // 0~5
  favorite     Boolean   @default(false)
  note         String?
  // 상태
  indexedAt    DateTime?
  missing      Boolean   @default(false) // 원본이 사라졌는지
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([countryId]); @@index([publisherId]); @@index([seriesId])
  @@index([favorite]); @@index([rating]); @@index([mtime]); @@index([contentHash])
}

model Entry {
  id         Int     @id @default(autoincrement())
  archiveId  Int
  archive    Archive @relation(fields: [archiveId], references: [id], onDelete: Cascade)
  name       String              // 압축 내 엔트리 경로
  order      Int                 // 자연정렬 후 페이지 순서
  sizeBytes  BigInt?
  width      Int?
  height     Int?
  isImage    Boolean @default(true)

  @@unique([archiveId, name])
  @@index([archiveId, order])
}

model Model {                     // 인물(모델)
  id        Int       @id @default(autoincrement())
  name      String    @unique
  aliases   String?                // JSON 배열 문자열 (별칭/표기 변형)
  profileImg String?
  bio       String?
  archives  ArchiveModel[]
  createdAt DateTime  @default(now())
}

model ArchiveModel {              // 다대다 조인
  archiveId Int
  modelId   Int
  archive   Archive @relation(fields: [archiveId], references: [id], onDelete: Cascade)
  model     Model   @relation(fields: [modelId], references: [id], onDelete: Cascade)
  @@id([archiveId, modelId])
}

model Publisher {
  id       Int       @id @default(autoincrement())
  name     String    @unique
  kind     String?                // 잡지사 | 스튜디오 | 개인 등
  archives Archive[]
}

model Country {
  id       Int       @id @default(autoincrement())
  code     String    @unique      // JP, KR, ...
  name     String
  archives Archive[]
}

model Series {
  id       Int       @id @default(autoincrement())
  name     String
  archives Archive[]
}

model Tag {
  id       Int        @id @default(autoincrement())
  name     String     @unique
  archives ArchiveTag[]
}
model ArchiveTag {
  archiveId Int
  tagId     Int
  archive   Archive @relation(fields: [archiveId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([archiveId, tagId])
}

model Job {
  id        Int      @id @default(autoincrement())
  type      String                // index | thumbnail | repack
  status    String   @default("pending") // pending|running|done|failed
  payload   String                // JSON
  progress  Float    @default(0)
  error     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 3. 검색 / 패싯
- 단계 1: `LIKE`/인덱스 기반 + 패싯(모델/출판사/국가/태그/즐겨찾기/평점) 필터.
- 확장: SQLite **FTS5**(파일명·메모·모델 별칭 전문검색) 또는 Postgres `pg_trgm`.

## 4. 파일명 휴리스틱 파싱 (그라비아 명명 관례)
- 흔한 패턴: `[제작주체] 모델명 - 타이틀 (호수/날짜)` 등 다양.
- 파서는 **추정 후 사용자 확정** 모델: 괄호/대괄호/구분자(`-`,`_`) 토큰화 →
  사전(기존 Model/Publisher 명·별칭) 매칭 우선 → 미매칭 토큰은 후보 제시.
- 규칙은 설정 가능한 정규식 룰셋으로 분리(라이브러리별 명명 편차 대응).

## 5. 식별/추적 정책 (확정: 내용 해시 기반)
- **1차 식별키 = `contentHash`** (파일 전체 해시). 파일을 옮기거나 이름만 바꿔도
  동일 해시 → 동일 레코드로 인식하여 메타데이터(모델/태그/평점) 유지.
- **알고리즘**: BLAKE3 또는 xxHash64 권장. SHA-256보다 수 배 빠르고 식별 용도에
  충분(암호학적 보안 목적 아님). 부분 해시는 충돌 위험이 있어 **전체 해시** 사용.
- **계산 비용 관리**: 해시는 파일당 1회만 계산하고 `(sizeBytes, mtime)`가 동일하면
  재계산하지 않음(캐시). 초기 대량 스캔은 IO 집약적이므로 야간/증분 스캔 권장.
- **이동/리네임 처리**: 스캔 중 동일 `contentHash`가 다른 경로에서 발견되면 기존
  레코드의 `path`만 갱신(메타 보존). 기존 경로의 파일이 사라졌으면 `missing=true`로
  유예 표시 후, 동일 해시가 재발견되면 자동 복원.
- **편집(재압축) 시**: 내용이 바뀌므로 `contentHash`가 변경됨 → 같은 레코드를
  갱신(새 해시로 update)하여 메타데이터를 그대로 승계. 원본 백업본은 별도 추적.
