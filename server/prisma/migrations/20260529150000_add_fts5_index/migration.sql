-- SQLite FTS5 가상 테이블 — 파일명/제목/메모 전문검색.
-- 트리그램 토크나이저로 CJK 부분 일치 지원.
-- 동기화는 어플리케이션 레벨에서 처리(SearchIndexService).

CREATE VIRTUAL TABLE "ArchiveFts" USING fts5(
  archiveId UNINDEXED,
  text,
  tokenize = 'trigram'
);
