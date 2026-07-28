/**
 * 취소·동시성 제어 유틸.
 * - AbortError / throwIfAborted: 표준 AbortSignal 기반 취소.
 * - Semaphore: 동시 실행 수를 제한. 대기 중 취소되면 슬롯을 잡지 않고 즉시 탈출.
 * - serialChain: 같은 키의 작업을 순차 실행(공유 리소스 동시 접근 방지).
 */

export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'AbortError' || e.name === 'ABORT_ERR')
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

interface Waiter {
  priority: number;
  seq: number;
  grant: () => void;
  onAbort?: () => void;
}

/**
 * 우선순위 스케줄러 — 동시 실행 수를 max 로 제한하되, 대기열에서 우선순위가
 * 높은(숫자가 작은) 작업을 먼저 깨운다. 같은 우선순위면 FIFO.
 * 대기 중 취소되면 슬롯을 잡지 않고 즉시 대기열에서 빠진다(핵심: 프리페치처럼
 * 아직 시작 안 한 작업은 사진집을 넘기는 순간 전부 드롭 → 보이는 페이지가 곧바로 실행).
 *
 * 고우선 슬롯 예약(reserved): 비-고우선(priority>=1) 작업은 최대 (max-reserved)
 * 개까지만 동시 실행된다. 프리페치가 슬롯을 다 먹어도 항상 reserved 개의 자리가
 * 보이는 페이지(priority 0)용으로 남아, 선점(진행 중 작업 kill) 없이도 현재
 * 페이지가 즉시 실행된다. 예약분은 고우선 작업이 없을 때 놀지만(프리페치 처리량
 * 약간 감소), 사용자가 실제로 기다리는 것은 보이는 페이지뿐이라 이 교환이 맞다.
 */
export class PriorityScheduler {
  private active = 0;
  private lowActive = 0; // priority>=1(비-고우선) 실행 수
  private seq = 0;
  private readonly waiters: Waiter[] = [];
  private readonly reserved: number;

  /**
   * @param max 총 동시 실행 상한.
   * @param reserved 고우선(priority 0) 전용으로 남길 슬롯 수. [0, max-1] 로 클램프
   *   (비-고우선이 최소 1슬롯은 쓸 수 있도록).
   */
  constructor(
    private readonly max: number,
    reserved = 0,
  ) {
    this.reserved = Math.max(0, Math.min(reserved, Math.max(0, max - 1)));
  }

  /** priority 우선순위의 작업을 지금 실행할 수 있는가(용량·예약 고려). */
  private canGrant(priority: number): boolean {
    if (this.active >= this.max) return false;
    if (priority === 0) return true; // 고우선: 총량 한도 안에서 항상
    return this.lowActive < this.max - this.reserved; // 비-고우선: 예약분 제외
  }

  private take(priority: number): void {
    this.active += 1;
    if (priority !== 0) this.lowActive += 1;
  }

  /** priority: 낮을수록 먼저. 0=보이는 페이지, 1=일반, 2=프리페치. */
  async acquire(priority = 1, signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.canGrant(priority)) {
      this.take(priority);
      return this.makeRelease(priority);
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        seq: this.seq++,
        grant: () => {
          if (waiter.onAbort && signal) {
            signal.removeEventListener('abort', waiter.onAbort);
          }
          this.take(priority);
          resolve(this.makeRelease(priority));
        },
      };
      if (signal) {
        waiter.onAbort = () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new AbortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private makeRelease(priority: number): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      if (priority !== 0) this.lowActive -= 1;
      this.wakeNext();
    };
  }

  /** 용량이 허락하는 한 우선순위 순으로 대기자를 깨운다(예약 규칙 준수). */
  private wakeNext(): void {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i];
        if (!this.canGrant(w.priority)) continue;
        if (best < 0) {
          best = i;
          continue;
        }
        const b = this.waiters[best];
        if (
          w.priority < b.priority ||
          (w.priority === b.priority && w.seq < b.seq)
        ) {
          best = i;
        }
      }
      if (best < 0) return;
      const [w] = this.waiters.splice(best, 1);
      w.grant(); // grant() 내부 take() 가 active/lowActive 를 증가 → 다음 루프에 반영
    }
  }
}

/**
 * 키별 순차 실행기 — 같은 키의 fn 을 이전 것이 끝난 뒤에 실행한다.
 * 압축 핸들처럼 동시 접근이 안전하지 않은 자원을 보호하는 데 사용.
 */
export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    // 체인 유지용 tail 은 성공/실패 모두 흡수(다음 작업이 막히지 않도록).
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    // 큐가 비면 맵에서 제거해 메모리 누수 방지.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
