import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { RepackDto } from './dto/repack.dto';
import { RepackService } from './repack.service';

@Controller('archives/:id/repack')
export class RepackController {
  constructor(
    private readonly repack: RepackService,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  async create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RepackDto,
  ): Promise<{ jobId: number; status: string }> {
    const jobId = await this.repack.start(id, dto.excludeEntries);
    return { jobId, status: 'pending' };
  }

  @Get(':jobId')
  async status(
    @Param('id', ParseIntPipe) _archiveId: number,
    @Param('jobId', ParseIntPipe) jobId: number,
  ) {
    const job = await this.jobs.get(jobId);
    if (!job) throw new NotFoundException('작업을 찾을 수 없습니다.');
    return job;
  }
}
