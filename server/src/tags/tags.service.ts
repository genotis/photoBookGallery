import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatchTagDto, UpsertTagDto } from './dto/tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const where: Prisma.TagWhereInput = q ? { name: { contains: q } } : {};
    const rows = await this.prisma.tag.findMany({
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

  async create(dto: UpsertTagDto) {
    try {
      return await this.prisma.tag.create({ data: dto });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(`태그가 이미 존재합니다: ${dto.name}`);
      }
      throw e;
    }
  }

  async patch(id: number, dto: PatchTagDto) {
    await this.ensureExists(id);
    try {
      return await this.prisma.tag.update({ where: { id }, data: dto });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('태그가 이미 존재합니다.');
      }
      throw e;
    }
  }

  async remove(id: number) {
    await this.ensureExists(id);
    await this.prisma.tag.delete({ where: { id } });
    return { ok: true as const };
  }

  private async ensureExists(id: number) {
    const t = await this.prisma.tag.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('태그를 찾을 수 없습니다.');
  }
}
