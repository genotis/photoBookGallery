import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildArchiveWhere } from '../archives/archives.service';
import { FacetsDto, SearchDto } from './dto/search.dto';
import { SearchIndexService } from './search-index.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchIndex: SearchIndexService,
  ) {}

  /**
   * 통합 검색. FTS5 로 파일명/제목/메모를 매칭하고,
   * 모델명/별칭/태그명은 LIKE 로 별도 매칭해 결과집합을 합친다.
   */
  async search(dto: SearchDto) {
    const q = dto.q.trim();
    if (!q) return { archives: [], models: [], tags: [] };

    const ftsIds = await this.searchIndex.search(q, 1000);

    const matchingModelIds = (
      await this.prisma.model.findMany({
        where: {
          OR: [{ name: { contains: q } }, { aliases: { contains: q } }],
        },
        select: { id: true },
      })
    ).map((m) => m.id);

    const matchingTagIds = (
      await this.prisma.tag.findMany({
        where: { name: { contains: q } },
        select: { id: true },
      })
    ).map((t) => t.id);

    const orParts: Prisma.ArchiveWhereInput[] = [];
    if (ftsIds.length) orParts.push({ id: { in: ftsIds } });
    if (matchingModelIds.length)
      orParts.push({ models: { some: { modelId: { in: matchingModelIds } } } });
    if (matchingTagIds.length)
      orParts.push({ tags: { some: { tagId: { in: matchingTagIds } } } });

    const where: Prisma.ArchiveWhereInput = orParts.length
      ? { missing: false, OR: orParts }
      : { id: -1 }; // 매칭 0건이면 빈 결과로 처리

    const [archives, models, tags] = await Promise.all([
      this.prisma.archive.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: dto.limit,
        include: {
          publisher: { select: { id: true, name: true } },
          models: { include: { model: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.model.findMany({
        where: { id: { in: matchingModelIds } },
        orderBy: { name: 'asc' },
        take: dto.limit,
        include: { _count: { select: { archives: true } } },
      }),
      this.prisma.tag.findMany({
        where: { id: { in: matchingTagIds } },
        orderBy: { name: 'asc' },
        take: dto.limit,
        include: { _count: { select: { archives: true } } },
      }),
    ]);

    return {
      archives: archives.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        format: a.format,
        pageCount: a.pageCount,
        favorite: a.favorite,
        rating: a.rating,
        hasCover: Boolean(a.coverEntry),
        missing: a.missing,
        publisher: a.publisher,
        models: a.models.map((m) => m.model),
      })),
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        count: m._count.archives,
      })),
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        count: t._count.archives,
      })),
    };
  }

  /**
   * 현재 필터 기준의 모델/출판사/국가/시리즈/태그 카운트.
   */
  async facets(dto: FacetsDto) {
    let ftsIds: number[] | null = null;
    if (dto.q && dto.q.trim()) {
      ftsIds = await this.searchIndex.search(dto.q.trim(), 1000);
      if (ftsIds.length === 0) {
        return { models: [], publishers: [], countries: [], series: [], tags: [] };
      }
    }
    const where = buildArchiveWhere({ ...dto, ftsIds });
    const archiveScope = await this.prisma.archive.findMany({
      where,
      select: { id: true, countryId: true, publisherId: true, seriesId: true },
    });
    const archiveIds = archiveScope.map((a) => a.id);

    if (archiveIds.length === 0) {
      return { models: [], publishers: [], countries: [], series: [], tags: [] };
    }

    const [modelLinks, tagLinks] = await Promise.all([
      this.prisma.archiveModel.findMany({
        where: { archiveId: { in: archiveIds } },
        select: { modelId: true },
      }),
      this.prisma.archiveTag.findMany({
        where: { archiveId: { in: archiveIds } },
        select: { tagId: true },
      }),
    ]);

    const tally = <K extends number>(ids: K[]): Map<K, number> => {
      const m = new Map<K, number>();
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    };

    const modelCounts = tally(modelLinks.map((l) => l.modelId));
    const tagCounts = tally(tagLinks.map((l) => l.tagId));
    const publisherCounts = tally(
      archiveScope.map((a) => a.publisherId).filter((x): x is number => x !== null),
    );
    const countryCounts = tally(
      archiveScope.map((a) => a.countryId).filter((x): x is number => x !== null),
    );
    const seriesCounts = tally(
      archiveScope.map((a) => a.seriesId).filter((x): x is number => x !== null),
    );

    const topIds = (counts: Map<number, number>): number[] =>
      Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, dto.topN)
        .map(([id]) => id);

    const [models, publishers, countries, series, tags] = await Promise.all([
      this.prisma.model.findMany({
        where: { id: { in: topIds(modelCounts) } },
        select: { id: true, name: true },
      }),
      this.prisma.publisher.findMany({
        where: { id: { in: topIds(publisherCounts) } },
        select: { id: true, name: true },
      }),
      this.prisma.country.findMany({
        where: { id: { in: topIds(countryCounts) } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.series.findMany({
        where: { id: { in: topIds(seriesCounts) } },
        select: { id: true, name: true },
      }),
      this.prisma.tag.findMany({
        where: { id: { in: topIds(tagCounts) } },
        select: { id: true, name: true },
      }),
    ]);

    const sortByCount = <T extends { id: number }>(
      rows: T[],
      counts: Map<number, number>,
    ): (T & { count: number })[] =>
      rows
        .map((r) => ({ ...r, count: counts.get(r.id) ?? 0 }))
        .sort((a, b) => b.count - a.count);

    return {
      models: sortByCount(models, modelCounts),
      publishers: sortByCount(publishers, publisherCounts),
      countries: sortByCount(countries, countryCounts),
      series: sortByCount(series, seriesCounts),
      tags: sortByCount(tags, tagCounts),
    };
  }
}
