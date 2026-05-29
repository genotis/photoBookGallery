export interface RawEntry {
  name: string;
  size: number;
  isDirectory: boolean;
}

/** 압축 해제 없이 아카이브를 읽는 어댑터. */
export interface ArchiveReader {
  listEntries(archivePath: string): Promise<RawEntry[]>;
  readEntry(archivePath: string, entryName: string): Promise<Buffer>;
}
