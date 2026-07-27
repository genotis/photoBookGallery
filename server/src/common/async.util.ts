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
 */
export class PriorityScheduler {
  private active = 0;
  private seq = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly max: number) {}

  /** priority: 낮을수록 먼저. 0=보이는 페이지, 1=일반, 2=프리페치. */
  async acquire(priority = 1, signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.active < this.max) {
      this.active += 1;
      return this.makeRelease();
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        seq: this.seq++,
        grant: () => {
          if (waiter.onAbort && signal) {
            signal.removeEventListener('abort', waiter.onAbort);
          }
          this.active += 1;
          resolve(this.makeRelease());
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

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.wakeNext();
    };
  }

  private wakeNext(): void {
    if (this.waiters.length === 0) return;
    let best = 0;
    for (let i = 1; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      const b = this.waiters[best];
      if (w.priority < b.priority || (w.priority === b.priority && w.seq < b.seq)) {
        best = i;
      }
    }
    const [w] = this.waiters.splice(best, 1);
    w.grant();
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
