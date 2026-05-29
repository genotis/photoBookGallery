import { Injectable } from '@nestjs/common';
import { Job } from '@prisma/client';
import { EventEmitter } from 'events';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  /** 작업 상태 변화를 SSE 구독자에게 알리기 위한 단일 채널. */
  private readonly bus = new EventEmitter();

  constructor(private readonly prisma: PrismaService) {
    // SSE 구독자가 많아질 수 있어 기본 10명 제한을 풀어둔다.
    this.bus.setMaxListeners(0);
  }

  /** 모든 작업 변경을 받는 구독자. 해제 함수를 돌려준다. */
  subscribe(listener: (job: Job) => void): () => void {
    this.bus.on('change', listener);
    return () => this.bus.off('change', listener);
  }

  private emit(job: Job): Job {
    this.bus.emit('change', job);
    return job;
  }

  async create(type: string, payload: unknown): Promise<Job> {
    return this.emit(
      await this.prisma.job.create({
        data: { type, payload: JSON.stringify(payload ?? {}), status: 'pending' },
      }),
    );
  }

  async start(id: number): Promise<Job> {
    return this.emit(
      await this.prisma.job.update({
        where: { id },
        data: { status: 'running', progress: 0, error: null },
      }),
    );
  }

  async setProgress(id: number, progress: number): Promise<Job> {
    return this.emit(
      await this.prisma.job.update({
        where: { id },
        data: { progress: Math.min(1, Math.max(0, progress)) },
      }),
    );
  }

  async done(id: number): Promise<Job> {
    return this.emit(
      await this.prisma.job.update({
        where: { id },
        data: { status: 'done', progress: 1 },
      }),
    );
  }

  async fail(id: number, error: unknown): Promise<Job> {
    return this.emit(
      await this.prisma.job.update({
        where: { id },
        data: { status: 'failed', error: String(error) },
      }),
    );
  }

  list(): Promise<Job[]> {
    return this.prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  get(id: number): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id } });
  }
}
