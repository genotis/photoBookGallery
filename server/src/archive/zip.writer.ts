import { Injectable } from '@nestjs/common';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

/**
 * 단순 ZIP(.cbz) 패키저.
 * 이미지 위주라 압축률보다 속도를 우선해 STORE(무압축) 사용.
 */
export interface ZipWriteEntry {
  name: string;
  body: Buffer;
}

@Injectable()
export class ZipWriter {
  /** entries 순서 그대로 outPath 에 .cbz 를 만든다. */
  async writeArchive(outPath: string, entries: ZipWriteEntry[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outPath);
      const archive = archiver('zip', { store: true });

      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      output.on('close', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      output.on('error', fail);
      archive.on('error', fail);
      archive.on('warning', (w) => {
        if ((w as NodeJS.ErrnoException).code !== 'ENOENT') fail(w);
      });

      archive.pipe(output);
      for (const e of entries) {
        archive.append(e.body, { name: e.name });
      }
      void archive.finalize();
    });
  }
}
