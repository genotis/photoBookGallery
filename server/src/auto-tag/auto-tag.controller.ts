import { Body, Controller, Post } from '@nestjs/common';
import { AutoTagService } from './auto-tag.service';
import { AutoTagDto, AutoTagPreviewDto } from './dto/auto-tag.dto';

@Controller('auto-tag')
export class AutoTagController {
  constructor(private readonly svc: AutoTagService) {}

  @Post('preview')
  preview(@Body() dto: AutoTagPreviewDto) {
    return this.svc.preview(dto);
  }

  @Post('apply')
  async apply(@Body() dto: AutoTagDto): Promise<{ jobId: number }> {
    const jobId = await this.svc.startApply(dto);
    return { jobId };
  }
}
