import { Injectable, OnModuleInit } from '@nestjs/common';
import { basename } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { compileMatcher } from '../classify/classify.util';

interface CompiledExclusion {
  id: number;
  re: RegExp;
}

/**
 * 렌더 제외 규칙 캐시 + 매칭.
 * - enabled 규칙만 컴파일해 메모리에 캐싱, CRUD 시 reload().
 * - 매칭은 엔트리의 basename(파일명) 기준 — 압축 내 경로가 아니라 파일명만 본다.
 * - 활성 규칙이 없으면 fast-path(제외 없음)로 동작해 페이지 서빙 비용 0.
 */
@Injectable()
export class ExclusionsService implements OnModuleInit {
  private compiled: CompiledExclusion[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** DB에서 enabled 규칙을 다시 읽어 컴파일. 잘못된 패턴은 조용히 건너뜀. */
  async reload(): Promise<void> {
    const rules = await this.prisma.renderExclusion.findMany({
      where: { enabled: true },
    });
    const compiled: CompiledExclusion[] = [];
    for (const r of rules) {
      try {
        compiled.push({ id: r.id, re: compileMatcher(r.matchType, r.pattern) });
      } catch {
        // 잘못된 패턴은 무시 (검증은 생성/수정 시점에서 수행)
      }
    }
    this.compiled = compiled;
  }

  /** 활성 제외 규칙이 하나라도 있는가 — fast-path 판별용. */
  hasActive(): boolean {
    return this.compiled.length > 0;
  }

  /** 엔트리 이름(압축 내 경로)이 제외 대상인가. basename 으로 매칭. */
  isExcluded(entryName: string): boolean {
    if (this.compiled.length === 0) return false;
    const base = basename(entryName);
    return this.compiled.some((c) => c.re.test(base));
  }

  /** 정렬된 엔트리에서 제외 대상을 걸러 표시 대상만 반환. */
  filterVisible<T extends { name: string }>(entries: T[]): T[] {
    if (this.compiled.length === 0) return entries;
    return entries.filter((e) => !this.isExcluded(e.name));
  }
}
