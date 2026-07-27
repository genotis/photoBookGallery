export interface RawEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  // ZIP 직독용(있을 때만). RAR 등은 undefined.
  method?: number; // 0=Store, 8=Deflate
  offset?: number; // 로컬 파일 헤더 오프셋
  compressedSize?: number;
}

/** 직독을 위한 ZIP 엔트리 위치. */
export interface EntryLocation {
  offset: number; // 로컬 헤더 오프셋
  method: number; // 0=Store, 8=Deflate
  size: number; // 원본 크기
  compSize: number; // 압축 크기(Store 면 size 와 동일)
}

/** 압축 해제 없이 아카이브를 읽는 어댑터. */
export interface ArchiveReader {
  listEntries(archivePath: string): Promise<RawEntry[]>;
  /** 단일 엔트리 추출. signal 이 abort 되면 진행 중 추출을 중단한다. */
  readEntry(
    archivePath: string,
    entryName: string,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  /** 캐시된 핸들이 있으면 회수(파일 교체/삭제 시). 없으면 no-op. */
  evict?(archivePath: string): Promise<void>;
}
