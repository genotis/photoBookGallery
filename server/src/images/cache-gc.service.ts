import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';

/**
 * 썸네일 캐시 디렉터리의 용량을 주기적으로 점검하고
 * 가장 오래 안 쓴 파일(가장 작은 atime)부터 삭제해 한계를 지킨다.
 *
 * - PBG_CACHE_MAX_MB 로 한계 설정(기본 2048MB).
 * - PBG_CACHE_GC_INTERVAL_MIN 분마다 실행(기본 30분).
 * - 시작 시 한 번 실행.
 */
@Injectable()
export class CacheGcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheGcService.name);
  private readonly cacheDir: string;
  private readonly maxBytes: number;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(config: ConfigService) {
    this.cacheDir = config.get<string>('cacheDir') ?? './cache';
    const maxMb = Number(process.env.PBG_CACHE_MAX_MB ?? 2048);
    this.maxBytes = (Number.isFinite(maxMb) ? maxMb : 2048) * 1024 * 1024;
    const intervalMin = Number(process.env.PBG_CACHE_GC_INTERVAL_MIN ?? 30);
    this.intervalMs =
      (Number.isFinite(intervalMin) ? intervalMin : 30) * 60 * 1000;
  }

  async onModuleInit(): Promise<void> {
    // 시작 시 한 번 실행 (실패해도 부팅은 막지 않음)
    void this.runOnce().catch((e) =>
      this.logger.warn(`초기 GC 실패: ${String(e)}`),
    );
    this.timer = setInterval(() => {
      void this.runOnce().catch((e) =>
        this.logger.warn(`주기 GC 실패: ${String(e)}`),
      );
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 외부에서 강제로 한 번 돌리고 결과를 반환. */
  async runOnce(): Promise<{ totalBytes: number; evicted: number }> {
    if (this.running) return { totalBytes: -1, evicted: 0 };
    this.running = true;
    try {
      const files = await this.collectFiles(this.cacheDir);
      const totalBytes = files.reduce((s, f) => s + f.size, 0);
      if (totalBytes <= this.maxBytes) {
        return { totalBytes, evicted: 0 };
      }

      // atime 오름차순(오래된 것부터) 정렬 → 한계 아래로 떨어질 때까지 제거
      files.sort((a, b) => a.atimeMs - b.atimeMs);
      let remaining = totalBytes;
      let evicted = 0;
      for (const f of files) {
        if (remaining <= this.maxBytes) break;
        try {
          await unlink(f.path);
          remaining -= f.size;
          evicted += 1;
        } catch (e) {
          this.logger.warn(`캐시 삭제 실패: ${f.path} — ${String(e)}`);
        }
      }
      this.logger.log(
        `캐시 GC: ${this.fmt(totalBytes)} → ${this.fmt(remaining)} ` +
          `(${evicted}개 제거, 한계 ${this.fmt(this.maxBytes)})`,
      );
      return { totalBytes: remaining, evicted };
    } finally {
      this.running = false;
    }
  }

  private async collectFiles(
    dir: string,
  ): Promise<{ path: string; size: number; atimeMs: number }[]> {
    const out: { path: string; size: number; atimeMs: number }[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      // 캐시 디렉터리가 아직 없으면 정상
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out;
      throw e;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await this.collectFiles(full)));
      } else if (e.isFile()) {
        try {
          const st = await stat(full);
          out.push({ path: full, size: st.size, atimeMs: st.atimeMs });
        } catch {
          // 파일이 사라졌다면 무시
        }
      }
    }
    return out;
  }

  private fmt(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024
      ? `${(mb / 1024).toFixed(2)}GB`
      : `${mb.toFixed(1)}MB`;
  }
}
