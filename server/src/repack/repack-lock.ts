import { Injectable } from '@nestjs/common';

/** archiveId 단위 직렬화. 동일 아카이브의 동시 편집을 막는다. */
@Injectable()
export class RepackLock {
  private chains = new Map<number, Promise<unknown>>();

  /** 같은 archiveId 의 이전 작업이 끝날 때까지 대기한 뒤 task() 를 실행한다. */
  async run<T>(archiveId: number, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(archiveId) ?? Promise.resolve();
    // 이전 작업 결과(성공/실패) 와 관계없이 다음 작업을 이어 돌린다.
    const next = prev.catch(() => undefined).then(task);
    this.chains.set(
      archiveId,
      next.catch(() => undefined),
    );
    return next;
  }
}
