import { spawn } from 'child_process';
import { AbortError, isAbortError } from './async.util';

/**
 * 단일 엔트리를 외부 프로세스(7z)로 stdout 스트리밍 추출한다.
 * - 전 포맷(zip/cbz/rar/cbr/7z) 공통. 특히 RAR 은 in-process WASM 이 전체 파일을
 *   메모리에 올리고 중단이 불가능한데, 서브프로세스는 abort 시 kill 로 즉시 멈춘다.
 * - abort → SIGKILL → 진행 중 추출(압축풀기) 즉시 중단.
 * - 7z 는 `*`/`?` 를 와일드카드로 해석하므로 그런 이름은 이 경로를 쓰면 안 된다.
 */
export function has7zWildcard(name: string): boolean {
  return /[*?]/.test(name);
}

export class ExtractorMissingError extends Error {}

export function extractEntryViaProcess(
  archivePath: string,
  entryName: string,
  signal?: AbortSignal,
  bin = '7z',
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    // e: 추출, -so: stdout 으로 데이터, -bso0: 표준 메시지 stdout 오염 방지,
    // -bse2: 에러는 stderr, -bsp0: 진행률 off, -y: 자동 확인.
    const child = spawn(
      bin,
      ['e', '-so', '-bso0', '-bse2', '-bsp0', '-y', archivePath, entryName],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 이미 종료됨 — 무시
      }
      settle(() => reject(new AbortError()));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));

    child.on('error', (e: NodeJS.ErrnoException) => {
      // 바이너리 부재(ENOENT) 등 spawn 실패 → 호출측이 폴백하도록 별도 에러.
      if (e.code === 'ENOENT') {
        settle(() => reject(new ExtractorMissingError(`${bin} 없음`)));
      } else {
        settle(() => reject(e));
      }
    });
    child.on('close', (code) => {
      if (signal?.aborted) {
        settle(() => reject(new AbortError()));
        return;
      }
      if (code === 0) {
        settle(() => resolve(Buffer.concat(out)));
      } else {
        const msg = Buffer.concat(err).toString().trim().slice(0, 200);
        settle(() => reject(new Error(`${bin} 추출 실패(code ${code}): ${msg}`)));
      }
    });
  });
}

/** 프로세스 추출을 시도하되, 바이너리 부재 시 폴백 함수로 넘어간다. */
export async function extractWithFallback(
  archivePath: string,
  entryName: string,
  signal: AbortSignal | undefined,
  fallback: () => Promise<Buffer>,
): Promise<Buffer> {
  if (has7zWildcard(entryName)) return fallback();
  try {
    return await extractEntryViaProcess(archivePath, entryName, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (e instanceof ExtractorMissingError) return fallback();
    // 그 외(포맷 인식 실패 등)도 안전하게 폴백.
    return fallback();
  }
}
