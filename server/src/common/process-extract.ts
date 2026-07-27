import { spawn } from 'child_process';
import { AbortError, isAbortError } from './async.util';

/**
 * 킬 가능한 외부 프로세스 실행 유틸.
 * - stdin 으로 입력 버퍼를 넣고 stdout 버퍼를 받는다(둘 다 선택).
 * - abort → SIGKILL → 진행 중 작업(압축풀기/리사이즈) 즉시 중단.
 * - 바이너리 부재(ENOENT)는 ExtractorMissingError 로 구분 → 호출측 폴백.
 *
 * 용도: 7z(단일 엔트리 추출), magick(리사이즈+webp 인코딩). in-process(WASM/sharp)
 * 는 시작하면 못 멈추지만, 서브프로세스는 kill 로 즉시 회수된다.
 */

export class ExtractorMissingError extends Error {}

export function has7zWildcard(name: string): boolean {
  return /[*?]/.test(name);
}

function runKillable(
  bin: string,
  args: string[],
  opts: { input?: Buffer; signal?: AbortSignal },
): Promise<Buffer> {
  const { input, signal } = opts;
  return new Promise<Buffer>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const child = spawn(bin, args, {
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

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
        // 이미 종료 — 무시
      }
      settle(() => reject(new AbortError()));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout!.on('data', (d: Buffer) => out.push(d));
    child.stderr!.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e: NodeJS.ErrnoException) => {
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
        settle(() => reject(new Error(`${bin} 실패(code ${code}): ${msg}`)));
      }
    });

    if (input) {
      // child 가 먼저 죽어 EPIPE 가 나도 무시(위 close/error 에서 처리).
      child.stdin!.on('error', () => undefined);
      child.stdin!.end(input);
    }
  });
}

/** 7z 로 단일 엔트리를 stdout 스트리밍 추출(킬 가능). */
export function extractEntryViaProcess(
  archivePath: string,
  entryName: string,
  signal?: AbortSignal,
  bin = '7z',
): Promise<Buffer> {
  return runKillable(
    bin,
    ['e', '-so', '-bso0', '-bse2', '-bsp0', '-y', archivePath, entryName],
    { signal },
  );
}

/**
 * magick 로 리사이즈+webp 인코딩(킬 가능). stdin=원본, stdout=webp.
 * `{width}x>` = 너비 기준, 확대 안 함(sharp withoutEnlargement 와 동일).
 * -auto-orient: EXIF 방향 보정, -strip: 메타 제거.
 */
export function resizeViaProcess(
  raw: Buffer,
  width: number,
  quality: number,
  signal?: AbortSignal,
  bin = 'magick',
): Promise<Buffer> {
  return runKillable(
    bin,
    [
      '-',
      '-auto-orient',
      '-strip',
      '-resize',
      `${width}x>`,
      '-quality',
      String(quality),
      'webp:-',
    ],
    { input: raw, signal },
  );
}

/** 프로세스 추출을 시도하되, 바이너리 부재/실패 시 폴백 함수로 넘어간다. */
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
    // 바이너리 부재/포맷 인식 실패 등 → 안전하게 폴백.
    return fallback();
  }
}
