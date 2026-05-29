import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { Job } from '@prisma/client';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(): Promise<Job[]> {
    return this.jobs.list();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number): Promise<Job> {
    const job = await this.jobs.get(id);
    if (!job) {
      throw new NotFoundException('작업을 찾을 수 없습니다.');
    }
    return job;
  }
}
