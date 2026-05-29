import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatchCountryDto, UpsertCountryDto } from './dto/country.dto';

@Injectable()
export class CountriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const where: Prisma.CountryWhereInput = q
      ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] }
      : {};
    const rows = await this.prisma.country.findMany({
      where,
      orderBy: { code: 'asc' },
      include: { _count: { select: { archives: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      count: r._count.archives,
    }));
  }

  async create(dto: UpsertCountryDto) {
    try {
      return await this.prisma.country.create({ data: dto });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(`코드가 이미 존재합니다: ${dto.code}`);
      }
      throw e;
    }
  }

  async patch(id: number, dto: PatchCountryDto) {
    await this.ensureExists(id);
    try {
      return await this.prisma.country.update({ where: { id }, data: dto });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('코드가 이미 존재합니다.');
      }
      throw e;
    }
  }

  async remove(id: number) {
    await this.ensureExists(id);
    // 참조는 onDelete: SET NULL 이므로 아카이브 분류가 풀린다.
    await this.prisma.country.delete({ where: { id } });
    return { ok: true as const };
  }

  private async ensureExists(id: number) {
    const c = await this.prisma.country.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('국가를 찾을 수 없습니다.');
  }
}
