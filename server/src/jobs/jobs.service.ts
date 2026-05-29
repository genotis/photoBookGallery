import { Injectable } from '@nestjs/common';
import { Job } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  create(type: string, payload: unknown): Promise<Job> {
    return this.prisma.job.create({
      data: { type, payload: JSON.stringify(payload ?? {}), status: 'pending' },
    });
  }

  start(id: number): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'running', progress: 0, error: null },
    });
  }

  setProgress(id: number, progress: number): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { progress: Math.min(1, Math.max(0, progress)) },
    });
  }

  done(id: number): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'done', progress: 1 },
    });
  }

  fail(id: number, error: unknown): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'failed', error: String(error) },
    });
  }

  list(): Promise<Job[]> {
    return this.prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  get(id: number): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id } });
  }
}
