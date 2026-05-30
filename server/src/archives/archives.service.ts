import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchIndexService } from '../search/search-index.service';
import { BatchArchiveDto } from './dto/batch-archive.dto';
import { ListArchivesDto } from './dto/list-archives.dto';
import { PatchArchiveDto } from './dto/patch-archive.dto';

const SORT_FIELD: Record<string, keyof Prisma.ArchiveOrderByWithRelationInput> = {
  name: 'fileName',
  mtime: 'mtime',
  pageCount: 'pageCount',
  rating: 'rating',
  createdAt: 'createdAt',
};

export interface ArchiveListItem {
  id: number;
  fileName: string;
  title: string | null;
  format: string;
  pageCount: number;
  favorite: boolean;
  rating: number | null;
  hasCover: boolean;
  missing: boolean;
  /** 콘텐츠 해시 — 재압축 시 바뀌므로 이미지 URL 의 버스터로 사용. */
  contentHash: string;
  publisher: { id: number; name: string } | null;
  models: { id: number; name: string }[];
}

export function buildArchiveWhere(
  dto: Pick<
    ListArchivesDto,
    | 'format'
    | 'favorite'
    | 'includeMissing'
    | 'country'
    | 'publisher'
    | 'series'
    | 'model'
    | 'tag'
    | 'ratingMin'
    | 'pathPrefix'
  > & { ftsIds?: number[] | null },
): Prisma.ArchiveWhereInput {
  const where: Prisma.ArchiveWhereInput = {};
  if (!dto.includeMissing) where.missing = false;
  if (dto.ftsIds !== undefined && dto.ftsIds !== null) {
    where.id = { in: dto.ftsIds };
  }
  if (dto.format) where.format = dto.format;
  if (dto.favorite !== undefined) where.favorite = dto.favorite;
  if (dto.ratingMin !== undefined) where.rating = { gte: dto.ratingMin };
  if (dto.country?.length) where.countryId = { in: dto.country };
  if (dto.publisher?.length) where.publisherId = { in: dto.publisher };
  if (dto.series?.length) where.seriesId = { in: dto.series };
  if (dto.model?.length) {
    where.models = { some: { modelId: { in: dto.model } } };
  }
  if (dto.tag?.length) {
    where.tags = { some: { tagId: { in: dto.tag } } };
  }
  if (dto.pathPrefix) {
    const prefix = dto.pathPrefix.endsWith('/')
      ? dto.pathPrefix
      : dto.pathPrefix + '/';
    where.path = { startsWith: prefix };
  }
  return where;
}

@Injectable()
export class ArchivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchIndex: SearchIndexService,
  ) {}

  async list(dto: ListArchivesDto): Promise<{
    items: ArchiveListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    // q 가 주어지면 FTS5 로 매칭 id 를 받아 정형 필터와 교집합으로 적용.
    // 빈 결과면 즉시 종료.
    let ftsIds: number[] | null = null;
    if (dto.q && dto.q.trim()) {
      ftsIds = await this.searchIndex.search(dto.q.trim(), 1000);
      if (ftsIds.length === 0) {
        return { items: [], total: 0, page: dto.page, limit: dto.limit };
      }
    }
    const where = buildArchiveWhere({ ...dto, ftsIds });
    const orderBy: Prisma.ArchiveOrderByWithRelationInput = {
      [SORT_FIELD[dto.sort] ?? 'createdAt']: dto.order,
    };

    const [rows, total] = await Promise.all([
      this.prisma.archive.findMany({
        where,
        orderBy,
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
        include: {
          publisher: { select: { id: true, name: true } },
          models: { include: { model: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.archive.count({ where }),
    ]);

    const items: ArchiveListItem[] = rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      title: a.title,
      format: a.format,
      pageCount: a.pageCount,
      favorite: a.favorite,
      rating: a.rating,
      hasCover: Boolean(a.coverEntry),
      missing: a.missing,
      contentHash: a.contentHash,
      publisher: a.publisher,
      models: a.models.map((m) => m.model),
    }));

    return { items, total, page: dto.page, limit: dto.limit };
  }

  detail(id: number) {
    return this.prisma.archive.findUnique({
      where: { id },
      include: {
        country: true,
        publisher: true,
        series: true,
        models: { include: { model: true } },
        tags: { include: { tag: true } },
        _count: { select: { entries: true } },
      },
    });
  }

  entries(id: number) {
    return this.prisma.entry.findMany({
      where: { archiveId: id },
      orderBy: { order: 'asc' },
      select: { order: true, name: true },
    });
  }

  /**
   * 미싱 제외 + RANDOM() 으로 N개 추출. SQLite 의 RANDOM() 은 매 호출 다른 순서.
   * id 목록만 raw 로 뽑고 본 데이터는 Prisma include 로 가져와 직렬화 일관성 유지.
   */
  async random(count: number): Promise<{ items: ArchiveListItem[] }> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "Archive"
      WHERE "missing" = 0
      ORDER BY RANDOM()
      LIMIT ${count}
    `;
    const ids = rows.map((r) => Number(r.id));
    if (ids.length === 0) return { items: [] };
    const archives = await this.prisma.archive.findMany({
      where: { id: { in: ids } },
      include: {
        publisher: { select: { id: true, name: true } },
        models: { include: { model: { select: { id: true, name: true } } } },
      },
    });
    // findMany 결과는 정렬을 보장하지 않으므로 위에서 받은 random 순서대로 재정렬.
    const byId = new Map(archives.map((a) => [a.id, a]));
    const items: ArchiveListItem[] = ids
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({
        id: a.id,
        fileName: a.fileName,
        title: a.title,
        format: a.format,
        pageCount: a.pageCount,
        favorite: a.favorite,
        rating: a.rating,
        hasCover: Boolean(a.coverEntry),
        missing: a.missing,
        contentHash: a.contentHash,
        publisher: a.publisher,
        models: a.models.map((m) => m.model),
      }));
    return { items };
  }

  /** 메타 수정. modelIds/tagIds 가 오면 해당 관계를 그 집합으로 교체한다. */
  async patch(id: number, dto: PatchArchiveDto) {
    const archive = await this.prisma.archive.findUnique({ where: { id } });
    if (!archive) throw new NotFoundException('아카이브를 찾을 수 없습니다.');

    const data: Prisma.ArchiveUpdateInput = {};
    if ('countryId' in dto) {
      data.country =
        dto.countryId === null
          ? { disconnect: true }
          : dto.countryId !== undefined
            ? { connect: { id: dto.countryId } }
            : undefined;
    }
    if ('publisherId' in dto) {
      data.publisher =
        dto.publisherId === null
          ? { disconnect: true }
          : dto.publisherId !== undefined
            ? { connect: { id: dto.publisherId } }
            : undefined;
    }
    if ('seriesId' in dto) {
      data.series =
        dto.seriesId === null
          ? { disconnect: true }
          : dto.seriesId !== undefined
            ? { connect: { id: dto.seriesId } }
            : undefined;
    }
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.favorite !== undefined) data.favorite = dto.favorite;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.publishedAt !== undefined) {
      data.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    }
    if (dto.coverEntry !== undefined) data.coverEntry = dto.coverEntry;
    if (dto.title !== undefined) data.title = dto.title;

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.archive.update({ where: { id }, data });
      }
      if (dto.modelIds !== undefined) {
        await tx.archiveModel.deleteMany({ where: { archiveId: id } });
        if (dto.modelIds.length) {
          await tx.archiveModel.createMany({
            data: dto.modelIds.map((modelId) => ({ archiveId: id, modelId })),
          });
        }
      }
      if (dto.tagIds !== undefined) {
        await tx.archiveTag.deleteMany({ where: { archiveId: id } });
        if (dto.tagIds.length) {
          await tx.archiveTag.createMany({
            data: dto.tagIds.map((tagId) => ({ archiveId: id, tagId })),
          });
        }
      }
    });

    // FTS 인덱스 갱신 — title/note 가 바뀌었을 수 있음
    if (dto.title !== undefined || dto.note !== undefined) {
      await this.searchIndex.reindex(id);
    }

    return this.detail(id);
  }

  /** 일괄 편집. set 으로 절대값을 지정하고, add/remove 로 태그·모델 관계를 증감한다. */
  async batch(dto: BatchArchiveDto) {
    const ids = Array.from(new Set(dto.ids));
    const updated = await this.prisma.$transaction(async (tx) => {
      // set: 외래키 / 평점 / 즐겨찾기
      if (dto.set) {
        const set = dto.set;
        const data: Prisma.ArchiveUpdateManyMutationInput &
          Pick<
            Prisma.ArchiveUncheckedUpdateManyInput,
            'countryId' | 'publisherId' | 'seriesId'
          > = {};
        if ('countryId' in set) data.countryId = set.countryId;
        if ('publisherId' in set) data.publisherId = set.publisherId;
        if ('seriesId' in set) data.seriesId = set.seriesId;
        if (set.favorite !== undefined) data.favorite = set.favorite;
        if (set.rating !== undefined) data.rating = set.rating;
        if (Object.keys(data).length) {
          await tx.archive.updateMany({ where: { id: { in: ids } }, data });
        }
      }

      // 태그 추가/제거. SQLite 는 skipDuplicates 미지원이라 기존 쌍을 미리 걸러낸다.
      if (dto.addTags?.length) {
        const existing = await tx.archiveTag.findMany({
          where: { archiveId: { in: ids }, tagId: { in: dto.addTags } },
          select: { archiveId: true, tagId: true },
        });
        const have = new Set(existing.map((r) => `${r.archiveId}:${r.tagId}`));
        const rows: Prisma.ArchiveTagCreateManyInput[] = [];
        for (const archiveId of ids) {
          for (const tagId of dto.addTags) {
            if (!have.has(`${archiveId}:${tagId}`)) {
              rows.push({ archiveId, tagId });
            }
          }
        }
        if (rows.length) await tx.archiveTag.createMany({ data: rows });
      }
      if (dto.removeTags?.length) {
        await tx.archiveTag.deleteMany({
          where: { archiveId: { in: ids }, tagId: { in: dto.removeTags } },
        });
      }

      // 모델 추가/제거
      if (dto.addModels?.length) {
        const existing = await tx.archiveModel.findMany({
          where: { archiveId: { in: ids }, modelId: { in: dto.addModels } },
          select: { archiveId: true, modelId: true },
        });
        const have = new Set(existing.map((r) => `${r.archiveId}:${r.modelId}`));
        const rows: Prisma.ArchiveModelCreateManyInput[] = [];
        for (const archiveId of ids) {
          for (const modelId of dto.addModels) {
            if (!have.has(`${archiveId}:${modelId}`)) {
              rows.push({ archiveId, modelId });
            }
          }
        }
        if (rows.length) await tx.archiveModel.createMany({ data: rows });
      }
      if (dto.removeModels?.length) {
        await tx.archiveModel.deleteMany({
          where: { archiveId: { in: ids }, modelId: { in: dto.removeModels } },
        });
      }

      return ids.length;
    });

    return { updated };
  }
}
