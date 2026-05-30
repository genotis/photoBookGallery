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
    // 클라이언트가 URL 에 contentHash(`?v=…`) 를 항상 부착하므로
    // "같은 URL = 같은 콘텐츠" 가 보장된다 → immutable 안전 + 1년 캐시로 최대 효율.
    // 재압축 시 contentHash 가 바뀌어 URL 도 바뀌므로 자동으로 새 요청이 나간다.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', img.etag);
    res.end(img.buffer);
  }
}
