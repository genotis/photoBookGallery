import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatchPublisherDto, UpsertPublisherDto } from './dto/publisher.dto';

@Injectable()
export class PublishersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const where: Prisma.PublisherWhereInput = q
      ? { name: { contains: q } }
      : {};
    const rows = await this.prisma.publisher.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { archives: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      count: r._count.archives,
    }));
  }

  async create(dto: UpsertPublisherDto) {
    try {
      return await this.prisma.publisher.create({ data: dto });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(`이름이 이미 존재합니다: ${dto.name}`);
      }
      throw e;
    }
  }

  async patch(id: number, dto: PatchPublisherDto) {
    await this.ensureExists(id);
    try {
      return await this.prisma.publisher.update({ where: { id }, data: dto });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('이름이 이미 존재합니다.');
      }
      throw e;
    }
  }

  async remove(id: number) {
    await this.ensureExists(id);
    await this.prisma.publisher.delete({ where: { id } });
    return { ok: true as const };
  }

  private async ensureExists(id: number) {
    const p = await this.prisma.publisher.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('출판사를 찾을 수 없습니다.');
  }
}
