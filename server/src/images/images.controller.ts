import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ExclusionsService } from '../exclusions/exclusions.service';
import { isAbortError } from '../common/async.util';
import {
  EntryLoc,
  ImageSize,
  RenderedImage,
  ThumbnailService,
} from './thumbnail.service';

const VALID_SIZES: ImageSize[] = ['thumb', 'preview', 'full'];

// 직독 위치 포함 엔트리 조회 셀렉트.
const ENTRY_SELECT = {
  name: true,
  method: true,
  locOffset: true,
  compSize: true,
  sizeBytes: true,
} as const;

interface EntryRow {
  name: string;
  method: number | null;
  locOffset: bigint | null;
  compSize: bigint | null;
  sizeBytes: bigint | null;
}

function toLoc(e: EntryRow): EntryLoc {
  return {
    method: e.method,
    offset: e.locOffset,
    compSize: e.compSize,
    size: e.sizeBytes,
  };
}

@Controller('archives/:id')
export class ImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thumbnails: ThumbnailService,
    private readonly exclusions: ExclusionsService,
  ) {}

  @Get('cover.webp')
  async cover(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const archive = await this.prisma.archive.findUnique({ where: { id } });
    if (!archive || !archive.coverEntry) {
      throw new NotFoundException('표지를 찾을 수 없습니다.');
    }
    // 표지 엔트리가 제외 대상(광고 등)이면 첫 표시 엔트리로 대체.
    let coverEntry = archive.coverEntry;
    let coverRow = await this.coverEntryRow(id, coverEntry);
    if (this.exclusions.hasActive() && this.exclusions.isExcluded(coverEntry)) {
      const first = await this.firstVisibleEntry(id);
      if (first) {
        coverEntry = first.name;
        coverRow = first;
      }
    }
    const signal = this.signalFor(req, res);
    try {
      const img = await this.thumbnails.render(
        archive,
        coverEntry,
        'thumb',
        signal,
        1,
        coverRow ? toLoc(coverRow) : undefined,
      );
      this.send(req, res, img);
    } catch (e) {
      this.handleError(e, res, signal);
    }
  }

  @Get('page/:index')
  async page(
    @Param('id', ParseIntPipe) id: number,
    @Param('index', ParseIntPipe) index: number,
    @Query('size') size: string,
    @Query('pr') pr: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const archive = await this.prisma.archive.findUnique({ where: { id } });
    if (!archive) {
      throw new NotFoundException('아카이브를 찾을 수 없습니다.');
    }
    const entry = await this.resolveEntry(id, index);
    if (!entry) {
      throw new NotFoundException('페이지를 찾을 수 없습니다.');
    }
    const entryName = entry.name;
    const chosen: ImageSize = VALID_SIZES.includes(size as ImageSize)
      ? (size as ImageSize)
      : 'preview';
    // pr: high=0(보이는 페이지) / low=2(프리페치) / 그 외=1(일반)
    const priority = pr === 'high' ? 0 : pr === 'low' ? 2 : 1;
    const signal = this.signalFor(req, res);
    try {
      const img = await this.thumbnails.render(
        archive,
        entryName,
        chosen,
        signal,
        priority,
        toLoc(entry),
      );
      this.send(req, res, img);
    } catch (e) {
      this.handleError(e, res, signal);
    }
  }

  /**
   * 클라이언트 연결이 끊기면 abort 되는 신호를 만든다. 뷰어에서 페이지를
   * 넘기거나 사진집을 전환하면 브라우저가 진행 중 요청을 취소 → 여기서 abort 되어
   * 서버의 압축풀기/sharp 도 중단되고, 대기 중이던 작업은 슬롯을 잡지 않는다.
   * res 의 'close' 는 응답 완료·연결 종료 모두에서 발생 → writableEnded 로 구분.
   */
  private signalFor(req: Request, res: Response): AbortSignal {
    const ac = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) ac.abort();
    };
    res.on('close', onClose);
    req.on('close', onClose);
    req.on('aborted', () => ac.abort());
    return ac.signal;
  }

  /** 취소면 조용히 종료(499), 그 외는 상위로 던져 예외 필터가 처리. */
  private handleError(e: unknown, res: Response, signal: AbortSignal): void {
    if (signal.aborted || isAbortError(e)) {
      if (!res.headersSent) res.status(499).end();
      return;
    }
    throw e;
  }

  /**
   * 페이지 인덱스 → 엔트리 이름 해석.
   * 활성 제외 규칙이 없으면 order == 인덱스 fast-path.
   * 있으면 표시 엔트리(제외 필터 후)를 순서대로 나열해 i번째를 고른다 —
   * entries() 가 뷰어에 내려주는 목록과 정확히 같은 위치 규칙.
   */
  private async resolveEntry(
    archiveId: number,
    index: number,
  ): Promise<EntryRow | null> {
    if (!this.exclusions.hasActive()) {
      const entry = await this.prisma.entry.findFirst({
        where: { archiveId, order: index },
        select: ENTRY_SELECT,
      });
      return entry ?? null;
    }
    const rows = await this.prisma.entry.findMany({
      where: { archiveId },
      orderBy: { order: 'asc' },
      select: ENTRY_SELECT,
    });
    const visible = this.exclusions.filterVisible(rows);
    return visible[index] ?? null;
  }

  private async firstVisibleEntry(
    archiveId: number,
  ): Promise<EntryRow | null> {
    const rows = await this.prisma.entry.findMany({
      where: { archiveId },
      orderBy: { order: 'asc' },
      select: ENTRY_SELECT,
    });
    return this.exclusions.filterVisible(rows)[0] ?? null;
  }

  private coverEntryRow(
    archiveId: number,
    name: string,
  ): Promise<EntryRow | null> {
    return this.prisma.entry.findFirst({
      where: { archiveId, name },
      select: ENTRY_SELECT,
    });
  }

  private send(req: Request, res: Response, img: RenderedImage): void {
    if (req.headers['if-none-match'] === img.etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', img.contentType);
    // 클라이언트가 URL 에 contentHash(`?v=…`) 를 항상 부착하므로
    // "같은 URL = 같은 콘텐츠" 가 보장된다 → immutable 안전 + 1년 캐시로 최대 효율.
    // 재압축 시 contentHash 가 바뀌어 URL 도 바뀌므로 자동으로 새 요청이 나간다.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', img.etag);
    res.end(img.buffer);
  }
}
