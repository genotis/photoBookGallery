import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job as BullJob } from 'bullmq';
import { FilenameParserService } from '../parser/filename.parser';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';
import { SearchIndexService } from '../search/search-index.service';
import { AutoTagDto, AutoTagPreviewDto } from './dto/auto-tag.dto';

const QUEUE = 'auto-tag';

export interface AutoTagPreviewItem {
  archiveId: number;
  fileName: string;
  current: {
    title: string | null;
    country: { id: number; code: string } | null;
    publisher: { id: number; name: string } | null;
    models: { id: number; name: string }[];
  };
  suggestion: {
    title: string | null;
    country: { code: string; existingId?: number } | null;
    publisher: { name: string; existingId?: number } | null;
    models: { name: string; aliases?: string[]; existingId?: number }[];
  };
  willChange: boolean;
}

export interface AutoTagPreview {
  total: number;
  sampled: number;
  items: AutoTagPreviewItem[];
}

interface ApplyStats {
  archives: number;
  newCountries: number;
  newPublishers: number;
  newModels: number;
}

function hasAnyMeta(a: {
  countryId: number | null;
  publisherId: number | null;
  modelsCount: number;
}): boolean {
  return Boolean(a.countryId) || Boolean(a.publisherId) || a.modelsCount > 0;
}

@Injectable()
export class AutoTagService implements OnModuleInit {
  private readonly logger = new Logger(AutoTagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: FilenameParserService,
    private readonly jobs: JobsService,
    private readonly searchIndex: SearchIndexService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker<AutoTagDto>(QUEUE, (job) => this.process(job));
  }

  private async process(bullJob: BullJob<AutoTagDto>): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    try {
      await this.runApply(jobId, bullJob.data);
    } catch (err) {
      this.logger.error(`자동 태깅 실패 (job ${jobId})`, err as Error);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }

  /** 어떤 아카이브가 어떻게 변경될지 미리보기. 실제 변경 없음. */
  async preview(dto: AutoTagPreviewDto): Promise<AutoTagPreview> {
    const candidates = await this.collectCandidates(dto);

    const limit = dto.sampleLimit ?? 50;
    const items: AutoTagPreviewItem[] = [];
    for (const a of candidates.slice(0, limit)) {
      const s = await this.parser.suggest(a.fileName);
      const willChange = this.computeWillChange(a, s);
      items.push({
        archiveId: a.id,
        fileName: a.fileName,
        current: {
          title: a.title,
          country: a.country ? { id: a.country.id, code: a.country.code } : null,
          publisher: a.publisher
            ? { id: a.publisher.id, name: a.publisher.name }
            : null,
          models: a.models.map((m) => ({ id: m.model.id, name: m.model.name })),
        },
        suggestion: {
          title: s.title,
          country: s.country
            ? { code: s.country.code, existingId: s.country.existingId }
            : null,
          publisher: s.publisher
            ? { name: s.publisher.name, existingId: s.publisher.existingId }
            : null,
          models: s.models.map((m) => ({
            name: m.name,
            aliases: m.aliases,
            existingId: m.existingId,
          })),
        },
        willChange,
      });
    }

    return {
      total: candidates.length,
      sampled: items.length,
      items,
    };
  }

  /** DB Job 생성 + 큐 enqueue. 즉시 jobId 반환. */
  async startApply(dto: AutoTagDto): Promise<number> {
    const job = await this.jobs.create('auto-tag', {
      onlyMissing: dto.onlyMissing ?? true,
      idCount: dto.ids?.length ?? null,
    });
    await this.queue.enqueue<AutoTagDto>(QUEUE, job.id, dto);
    return job.id;
  }

  private async runApply(jobId: number, dto: AutoTagDto): Promise<void> {
    await this.jobs.start(jobId);
    const candidates = await this.collectCandidates(dto);

    if (candidates.length === 0) {
      await this.jobs.done(jobId);
      return;
    }

    // 엔티티 캐시 (이번 배치 안에서 같은 이름을 중복 생성하지 않도록)
    const [countries, publishers, models] = await Promise.all([
      this.prisma.country.findMany(),
      this.prisma.publisher.findMany(),
      this.prisma.model.findMany(),
    ]);
    const countryByCode = new Map(
      countries.map((c) => [c.code.toUpperCase(), c.id]),
    );
    const publisherByName = new Map(
      publishers.map((p) => [p.name.toLowerCase(), p.id]),
    );
    const modelByName = new Map(
      models.map((m) => [m.name.toLowerCase(), m.id]),
    );

    const stats: ApplyStats = {
      archives: 0,
      newCountries: 0,
      newPublishers: 0,
      newModels: 0,
    };

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      try {
        const suggestion = await this.parser.suggest(a.fileName);
        const changed = await this.applyOne(
          a,
          suggestion,
          countryByCode,
          publisherByName,
          modelByName,
          stats,
        );
        if (changed) stats.archives += 1;
      } catch (e) {
        this.logger.warn(`auto-tag 실패 archive=${a.id}: ${String(e)}`);
      }
      if ((i + 1) % 5 === 0 || i + 1 === candidates.length) {
        await this.jobs.setProgress(jobId, (i + 1) / candidates.length);
      }
    }

    // 결과는 Job payload 에 누적 기록
    await this.prisma.job.update({
      where: { id: jobId },
      data: { payload: JSON.stringify({ ...dto, stats }) },
    });
    await this.jobs.done(jobId);
    this.logger.log(
      `자동 태깅 완료 (job ${jobId}): 아카이브 ${stats.archives}건, ` +
        `신규 국가 ${stats.newCountries}, 출판사 ${stats.newPublishers}, 모델 ${stats.newModels}`,
    );
  }

  /** 적용 후보 아카이브 로드. include 로 현재 메타 함께. */
  private async collectCandidates(dto: AutoTagDto) {
    const where: Prisma.ArchiveWhereInput = { missing: false };
    if (dto.ids?.length) where.id = { in: dto.ids };

    const rows = await this.prisma.archive.findMany({
      where,
      include: {
        country: { select: { id: true, code: true } },
        publisher: { select: { id: true, name: true } },
        models: { include: { model: { select: { id: true, name: true } } } },
      },
      orderBy: { id: 'asc' },
    });
    if (dto.onlyMissing === false) return rows;

    return rows.filter(
      (a) =>
        !hasAnyMeta({
          countryId: a.countryId,
          publisherId: a.publisherId,
          modelsCount: a.models.length,
        }),
    );
  }

  private computeWillChange(
    a: {
      countryId: number | null;
      publisherId: number | null;
      title: string | null;
      models: { modelId: number }[];
    },
    s: Awaited<ReturnType<FilenameParserService['suggest']>>,
  ): boolean {
    if (s.country && !a.countryId) return true;
    if (s.publisher && !a.publisherId) return true;
    if (s.title && !a.title) return true;
    const linked = new Set(a.models.map((m) => m.modelId));
    for (const m of s.models) {
      if (m.existingId === undefined) return true; // 새 모델
      if (!linked.has(m.existingId)) return true;
    }
    return false;
  }

  private async applyOne(
    a: {
      id: number;
      countryId: number | null;
      publisherId: number | null;
      title: string | null;
      models: { modelId: number }[];
    },
    s: Awaited<ReturnType<FilenameParserService['suggest']>>,
    countryByCode: Map<string, number>,
    publisherByName: Map<string, number>,
    modelByName: Map<string, number>,
    stats: ApplyStats,
  ): Promise<boolean> {
    let changed = false;
    const data: Prisma.ArchiveUncheckedUpdateInput = {};

    // 제목
    if (s.title && !a.title) {
      data.title = s.title;
      changed = true;
    }

    // 국가
    if (s.country && !a.countryId) {
      const code = s.country.code.toUpperCase();
      let id = countryByCode.get(code);
      if (!id) {
        const created = await this.prisma.country.create({
          data: { code, name: s.country.name ?? code },
        });
        id = created.id;
        countryByCode.set(code, id);
        stats.newCountries += 1;
      }
      data.countryId = id;
      changed = true;
    }

    // 출판사
    if (s.publisher && !a.publisherId) {
      const key = s.publisher.name.toLowerCase();
      let id = publisherByName.get(key);
      if (!id) {
        const created = await this.prisma.publisher.create({
          data: { name: s.publisher.name },
        });
        id = created.id;
        publisherByName.set(key, id);
        stats.newPublishers += 1;
      }
      data.publisherId = id;
      changed = true;
    }

    // 모델 관계
    const linked = new Set(a.models.map((m) => m.modelId));
    const toLink: number[] = [];
    for (const m of s.models) {
      let id = m.existingId;
      if (!id) {
        const key = m.name.toLowerCase();
        id = modelByName.get(key);
        if (!id) {
          const aliases = m.aliases?.length
            ? JSON.stringify(m.aliases)
            : null;
          const created = await this.prisma.model.create({
            data: { name: m.name, aliases },
          });
          id = created.id;
          modelByName.set(key, id);
          stats.newModels += 1;
        }
      }
      if (!linked.has(id)) {
        toLink.push(id);
        linked.add(id);
        changed = true;
      }
    }

    if (Object.keys(data).length || toLink.length) {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) {
          await tx.archive.update({ where: { id: a.id }, data });
        }
        if (toLink.length) {
          await tx.archiveModel.createMany({
            data: toLink.map((modelId) => ({ archiveId: a.id, modelId })),
          });
        }
      });
      // title 이 바뀐 경우 FTS 갱신
      if ('title' in data) {
        await this.searchIndex.reindex(a.id);
      }
    }
    return changed;
  }
}
