import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MergeModelDto,
  PatchModelDto,
  UpsertModelDto,
} from './dto/model.dto';

export interface ModelListItem {
  id: number;
  name: string;
  nameEn: string | null;
  aliases: string[];
  profileImg: string | null;
  bio: string | null;
  favorite: boolean;
  count: number;
  /** 갤러리 대표 표지 — 이 모델의 표지 있는 아카이브 하나. 없으면 null. */
  cover: { archiveId: number; contentHash: string } | null;
}

/** 목록 정렬·표시용 영문 우선 이름. */
function englishName(m: { name: string; nameEn: string | null }): string {
  return (m.nameEn?.trim() || m.name).toLowerCase();
}

function decodeAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function encodeAliases(arr: string[] | undefined): string | undefined {
  if (arr === undefined) return undefined;
  const cleaned = Array.from(new Set(arr.map((a) => a.trim()).filter(Boolean)));
  return JSON.stringify(cleaned);
}

@Injectable()
export class ModelsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 대표 표지 아카이브를 함께 뽑기 위한 include (표지 있고 missing 아닌 것 1개). */
  private readonly coverInclude = {
    _count: { select: { archives: true } },
    archives: {
      where: { archive: { coverEntry: { not: null }, missing: false } },
      take: 1,
      select: { archive: { select: { id: true, contentHash: true } } },
    },
  } satisfies Prisma.ModelInclude;

  private toItem(r: {
    id: number;
    name: string;
    nameEn: string | null;
    aliases: string | null;
    profileImg: string | null;
    bio: string | null;
    favorite: boolean;
    _count: { archives: number };
    archives: { archive: { id: number; contentHash: string } }[];
  }): ModelListItem {
    const cov = r.archives[0]?.archive;
    return {
      id: r.id,
      name: r.name,
      nameEn: r.nameEn,
      aliases: decodeAliases(r.aliases),
      profileImg: r.profileImg,
      bio: r.bio,
      favorite: r.favorite,
      count: r._count.archives,
      cover: cov ? { archiveId: cov.id, contentHash: cov.contentHash } : null,
    };
  }

  async list(q?: string): Promise<ModelListItem[]> {
    // 이름·영문·별칭 모두 포함 검색
    const where: Prisma.ModelWhereInput = q
      ? {
          OR: [
            { name: { contains: q } },
            { nameEn: { contains: q } },
            { aliases: { contains: q } },
          ],
        }
      : {};
    const rows = await this.prisma.model.findMany({
      where,
      include: this.coverInclude,
    });
    // 즐겨찾기 우선 → 영문 이름(nameEn ?? name) 사전순. SQLite 는 coalesce 정렬이
    // 까다로워 JS 로 정렬한다 (모델 수는 많지 않음).
    return rows
      .map((r) => this.toItem(r))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return englishName(a).localeCompare(englishName(b));
      });
  }

  async detail(id: number): Promise<ModelListItem> {
    const r = await this.prisma.model.findUnique({
      where: { id },
      include: this.coverInclude,
    });
    if (!r) throw new NotFoundException('모델을 찾을 수 없습니다.');
    return this.toItem(r);
  }

  async create(dto: UpsertModelDto): Promise<ModelListItem> {
    try {
      const r = await this.prisma.model.create({
        data: {
          name: dto.name,
          nameEn: dto.nameEn ?? null,
          aliases: encodeAliases(dto.aliases) ?? null,
          profileImg: dto.profileImg ?? null,
          bio: dto.bio ?? null,
        },
      });
      return {
        id: r.id,
        name: r.name,
        nameEn: r.nameEn,
        aliases: decodeAliases(r.aliases),
        profileImg: r.profileImg,
        bio: r.bio,
        favorite: r.favorite,
        count: 0,
        cover: null,
      };
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

  async patch(id: number, dto: PatchModelDto): Promise<ModelListItem> {
    await this.ensureExists(id);
    const data: Prisma.ModelUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.aliases !== undefined) data.aliases = encodeAliases(dto.aliases);
    if (dto.profileImg !== undefined) data.profileImg = dto.profileImg;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.favorite !== undefined) data.favorite = dto.favorite;
    try {
      await this.prisma.model.update({ where: { id }, data });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('이름이 이미 존재합니다.');
      }
      throw e;
    }
    return this.detail(id);
  }

  async remove(id: number) {
    await this.ensureExists(id);
    await this.prisma.model.delete({ where: { id } });
    return { ok: true as const };
  }

  /**
   * `fromId` 모델을 `intoId` 로 흡수한다.
   * - fromId 의 모든 아카이브 관계를 intoId 로 이전(중복은 무시)
   * - fromId 의 이름·별칭은 intoId 의 별칭으로 합산
   * - fromId 레코드는 삭제
   */
  async merge(fromId: number, dto: MergeModelDto): Promise<ModelListItem> {
    if (fromId === dto.intoId) {
      throw new BadRequestException('동일한 모델로 병합할 수 없습니다.');
    }
    const [from, into] = await Promise.all([
      this.prisma.model.findUnique({ where: { id: fromId } }),
      this.prisma.model.findUnique({ where: { id: dto.intoId } }),
    ]);
    if (!from) throw new NotFoundException('병합 원본 모델을 찾을 수 없습니다.');
    if (!into) throw new NotFoundException('병합 대상 모델을 찾을 수 없습니다.');

    const newAliases = Array.from(
      new Set([
        ...decodeAliases(into.aliases),
        ...decodeAliases(from.aliases),
        from.name,
      ]),
    ).filter((a) => a !== into.name);

    await this.prisma.$transaction(async (tx) => {
      const links = await tx.archiveModel.findMany({
        where: { modelId: fromId },
        select: { archiveId: true },
      });
      // intoId 와의 중복 관계는 무시하고 옮긴다
      for (const { archiveId } of links) {
        await tx.archiveModel.upsert({
          where: { archiveId_modelId: { archiveId, modelId: dto.intoId } },
          create: { archiveId, modelId: dto.intoId },
          update: {},
        });
      }
      await tx.archiveModel.deleteMany({ where: { modelId: fromId } });
      await tx.model.update({
        where: { id: dto.intoId },
        data: { aliases: encodeAliases(newAliases) ?? null },
      });
      await tx.model.delete({ where: { id: fromId } });
    });

    return this.detail(dto.intoId);
  }

  private async ensureExists(id: number) {
    const m = await this.prisma.model.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('모델을 찾을 수 없습니다.');
  }
}
