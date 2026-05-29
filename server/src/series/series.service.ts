import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatchSeriesDto, UpsertSeriesDto } from './dto/series.dto';

@Injectable()
export class SeriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const where: Prisma.SeriesWhereInput = q ? { name: { contains: q } } : {};
    const rows = await this.prisma.series.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { archives: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      count: r._count.archives,
    }));
  }

  create(dto: UpsertSeriesDto) {
    return this.prisma.series.create({ data: dto });
  }

  async patch(id: number, dto: PatchSeriesDto) {
    await this.ensureExists(id);
    return this.prisma.series.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.ensureExists(id);
    await this.prisma.series.delete({ where: { id } });
    return { ok: true as const };
  }

  private async ensureExists(id: number) {
    const s = await this.prisma.series.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('시리즈를 찾을 수 없습니다.');
  }
}
