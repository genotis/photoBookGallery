import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListArchivesDto } from './dto/list-archives.dto';

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
  format: string;
  pageCount: number;
  favorite: boolean;
  rating: number | null;
  hasCover: boolean;
  missing: boolean;
  publisher: { id: number; name: string } | null;
  models: { id: number; name: string }[];
}

@Injectable()
export class ArchivesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListArchivesDto): Promise<{
    items: ArchiveListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.ArchiveWhereInput = {};
    if (!dto.includeMissing) where.missing = false;
    if (dto.q) where.fileName = { contains: dto.q };
    if (dto.format) where.format = dto.format;
    if (dto.favorite !== undefined) where.favorite = dto.favorite;

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
      format: a.format,
      pageCount: a.pageCount,
      favorite: a.favorite,
      rating: a.rating,
      hasCover: Boolean(a.coverEntry),
      missing: a.missing,
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
}
