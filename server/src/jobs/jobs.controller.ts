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
import { Job } from '@prisma/client';
import { Request, Response } from 'express';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(): Promise<Job[]> {
    return this.jobs.list();
  }

  /**
   * Server-Sent Events 스트림. `?ids=1,2` 로 필터 가능.
   * 클라이언트가 접속하면 즉시 현재 상태를 한 번 push 한 뒤,
   * 이후 상태 변경이 발생할 때마다 push 한다. 15초마다 heartbeat.
   */
  @Get('stream')
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Query('ids') idsParam?: string,
  ): Promise<void> {
    const wanted = idsParam
      ? new Set(
          idsParam
            .split(',')
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && Number.isInteger(n)),
        )
      : null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 일부 프록시(nginx) 버퍼링 방지
    res.flushHeaders();

    const send = (job: Job) => {
      if (wanted && !wanted.has(job.id)) return;
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    };

    // 초기 스냅샷: 필터가 있으면 해당 작업들, 없으면 최근 작업들
    const seed = wanted
      ? await Promise.all([...wanted].map((id) => this.jobs.get(id)))
      : await this.jobs.list();
    for (const job of seed) if (job) send(job);

    const unsub = this.jobs.subscribe(send);
    const heartbeat = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 15_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsub();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
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
