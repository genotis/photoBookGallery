import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Job as BullJob,
  ConnectionOptions,
  Queue,
  Worker,
  WorkerOptions,
} from 'bullmq';

function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port ? Number(u.port) : 6379,
    password: u.password || undefined,
    username: u.username || undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) || 0 : 0,
    // BullMQ 권장 — 블로킹 명령에서 무한 대기 허용
    maxRetriesPerRequest: null,
  };
}

/**
 * 모든 백그라운드 작업을 BullMQ + Redis 로 직렬화한다.
 * - DB Job 레코드는 UI/SSE 의 단일 진실 원천 (그대로 유지).
 * - 큐 jobId 와 DB Job.id 를 동일 문자열로 맞춰 매핑 비용을 없앤다.
 * - 재시작 시 Redis 에서 대기/지연 작업을 자동 재개. 워커 크래시 시 stalled
 *   detection 으로 재할당.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection!: ConnectionOptions;
  private queues = new Map<string, Queue>();
  private workers: Worker[] = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.logger.log(`큐 백엔드: Redis (연결 지연 초기화)`);
  }

  /**
   * 커넥션을 지연 초기화한다. 워커 등록(registerWorker)이 QueueService 의
   * onModuleInit 보다 먼저 불릴 수 있어(모듈 init 순서 비보장), 최초 사용 시점에
   * 보장한다.
   */
  private ensureConnection(): ConnectionOptions {
    if (!this.connection) {
      const url =
        this.config.get<string>('redisUrl') ?? 'redis://localhost:6379';
      this.connection = parseRedisUrl(url);
    }
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  /** 큐는 처음 사용 시 생성, 이후 재사용. */
  getQueue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.ensureConnection(),
        defaultJobOptions: {
          attempts: 1, // 위험한 작업(재압축)은 기본 1회. 재시도가 안전한 작업만 옵션으로 늘림.
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 200 },
        },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  /** 큐 워커 등록. 모듈 init 시 호출. 종료 시 일괄 close. */
  registerWorker<T = unknown>(
    name: string,
    handler: (job: BullJob<T>) => Promise<void> | void,
    opts?: Partial<WorkerOptions>,
  ): Worker<T> {
    const worker = new Worker<T>(name, handler as never, {
      connection: this.ensureConnection(),
      concurrency: 1, // 단일 사용자 — 동시에 한 작업씩 (재압축 같은 위험 작업 보호)
      ...opts,
    });
    worker.on('error', (err) =>
      this.logger.warn(`worker[${name}] error: ${String(err)}`),
    );
    worker.on('failed', (job, err) =>
      this.logger.warn(
        `worker[${name}] job ${job?.id} failed: ${String(err)}`,
      ),
    );
    this.workers.push(worker);
    return worker;
  }

  /**
   * DB Job.id → BullMQ jobId 매핑(접두사 'pbg-'). BullMQ 는 숫자만으로 된
   * customId 를 거부하므로 접두사 필수. 동일 dbJobId 재호출은 멱등.
   */
  async enqueue<T>(name: string, dbJobId: number, payload: T): Promise<void> {
    const q = this.getQueue(name);
    await q.add(name, payload, { jobId: bullJobIdFor(dbJobId) });
  }
}

export function bullJobIdFor(dbJobId: number): string {
  return `pbg-${dbJobId}`;
}

/** BullMQ job.id ('pbg-5') → DB Job.id (5). 잘못된 형식이면 NaN. */
export function dbJobIdFrom(bullJobId: string | undefined): number {
  if (!bullJobId) return NaN;
  return Number(bullJobId.replace(/^pbg-/, ''));
}
