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
import { ImageSize, RenderedImage, ThumbnailService } from './thumbnail.service';

const VALID_SIZES: ImageSize[] = ['thumb', 'preview', 'full'];

@Controller('archives/:id')
export class ImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thumbnails: ThumbnailService,
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
    const img = await this.thumbnails.render(archive, archive.coverEntry, 'thumb');
    this.send(req, res, img);
  }

  @Get('page/:index')
  async page(
    @Param('id', ParseIntPipe) id: number,
    @Param('index', ParseIntPipe) index: number,
    @Query('size') size: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const archive = await this.prisma.archive.findUnique({ where: { id } });
    if (!archive) {
      throw new NotFoundException('아카이브를 찾을 수 없습니다.');
    }
    const entry = await this.prisma.entry.findFirst({
      where: { archiveId: id, order: index },
    });
    if (!entry) {
      throw new NotFoundException('페이지를 찾을 수 없습니다.');
    }
    const chosen: ImageSize = VALID_SIZES.includes(size as ImageSize)
      ? (size as ImageSize)
      : 'preview';
    const img = await this.thumbnails.render(archive, entry.name, chosen);
    this.send(req, res, img);
  }

  private send(req: Request, res: Response, img: RenderedImage): void {
    if (req.headers['if-none-match'] === img.etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', img.contentType);
    // immutable 은 쓰지 않는다 — 재압축으로 archiveId/page index 의 매핑이 바뀌면
    // 같은 URL 에 다른 콘텐츠가 매달리므로, 브라우저가 ETag 로 재검증할 수 있어야 한다.
    // ETag 는 콘텐츠 해시 기반이라 미변경 시 304 로 가볍게 빠진다.
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('ETag', img.etag);
    res.end(img.buffer);
  }
}
