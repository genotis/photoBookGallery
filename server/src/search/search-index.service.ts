import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SQLite FTS5 기반 전문검색 인덱스. 트리그램 토크나이저로 CJK 부분 일치 지원.
 * 인덱싱 대상: Archive.fileName, title, note (다른 분류축은 정형 필터로 처리).
 * 동기화는 호출자가 변경 시점에 reindex() 를 호출하는 방식.
 */
@Injectable()
export class SearchIndexService implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 부팅 시 인덱스가 비어있고 아카이브가 존재하면 초기 빌드
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM ArchiveFts
    `;
    const indexed = Number(rows[0]?.n ?? 0);
    const archives = await this.prisma.archive.count();
    if (indexed === 0 && archives > 0) {
      this.logger.log(`FTS 인덱스 비어있음 — ${archives}건 초기 빌드`);
      await this.rebuildAll();
    }
  }

  /** 단일 아카이브 재인덱스. */
  async reindex(archiveId: number): Promise<void> {
    const a = await this.prisma.archive.findUnique({
      where: { id: archiveId },
      select: { id: true, fileName: true, title: true, note: true },
    });
    await this.prisma.$executeRaw`
      DELETE FROM ArchiveFts WHERE archiveId = ${archiveId}
    `;
    if (!a) return;
    const text = [a.fileName, a.title ?? '', a.note ?? '']
      .filter((s) => s.length > 0)
      .join(' ');
    await this.prisma.$executeRaw`
      INSERT INTO ArchiveFts (archiveId, text) VALUES (${archiveId}, ${text})
    `;
  }

  /** 다수 아카이브 재인덱스. */
  async reindexMany(archiveIds: number[]): Promise<void> {
    for (const id of archiveIds) await this.reindex(id);
  }

  /** 전체 인덱스 재구축. */
  async rebuildAll(): Promise<{ indexed: number }> {
    await this.prisma.$executeRaw`DELETE FROM ArchiveFts`;
    const archives = await this.prisma.archive.findMany({
      select: { id: true, fileName: true, title: true, note: true },
    });
    for (const a of archives) {
      const text = [a.fileName, a.title ?? '', a.note ?? '']
        .filter((s) => s.length > 0)
        .join(' ');
      await this.prisma.$executeRaw`
        INSERT INTO ArchiveFts (archiveId, text) VALUES (${a.id}, ${text})
      `;
    }
    return { indexed: archives.length };
  }

  /**
   * q 매칭 archiveId 목록을 rank 순으로 반환.
   * 트리그램 토크나이저는 3자 미만 토큰을 인덱싱하지 않으므로,
   * 짧은 토큰을 포함한 질의는 LIKE 폴백을 사용한다.
   */
  async search(q: string, limit = 500): Promise<number[]> {
    const tokens = q
      .replace(/["()*+\-:^]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];

    const tooShort = tokens.some((t) => t.length < 3);
    if (tooShort) {
      const rows = await this.prisma.$queryRaw<{ archiveId: bigint | number }[]>`
        SELECT archiveId FROM ArchiveFts WHERE text LIKE ${'%' + tokens.join('%') + '%'} LIMIT ${limit}
      `;
      return rows.map((r) => Number(r.archiveId));
    }

    const expr = tokens.map((t) => `"${t}"`).join(' ');
    try {
      const rows = await this.prisma.$queryRaw<{ archiveId: bigint | number }[]>`
        SELECT archiveId FROM ArchiveFts
        WHERE text MATCH ${expr}
        ORDER BY rank
        LIMIT ${limit}
      `;
      // SQLite raw 쿼리는 정수도 BigInt 로 돌려줄 수 있어 Number 로 정규화.
      return rows.map((r) => Number(r.archiveId));
    } catch (e) {
      this.logger.warn(`FTS 검색 실패 (식=${expr}): ${String(e)}`);
      return [];
    }
  }
}

