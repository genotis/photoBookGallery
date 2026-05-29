import { createReadStream } from 'fs';
import { createBLAKE3 } from 'hash-wasm';

/**
 * 파일 전체 내용을 스트리밍하여 BLAKE3 해시를 계산한다.
 * 아카이브 식별 기준값 (경로/이름이 바뀌어도 동일).
 */
export async function hashFile(path: string): Promise<string> {
  const hasher = await createBLAKE3();
  hasher.init();
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hasher.update(chunk as Buffer));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hasher.digest('hex');
}

/** 캐시 키 등 짧은 식별자 생성용 (동기, 작은 문자열). */
export async function hashString(input: string): Promise<string> {
  const hasher = await createBLAKE3();
  hasher.init();
  hasher.update(input);
  return hasher.digest('hex');
}
