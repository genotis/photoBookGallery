import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';

interface TreeNode {
  name: string;
  path: string;
  archiveCount: number;
}

@Controller('tree')
export class TreeController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 등록된 LibraryRoot 화이트리스트 하위만 노출한다. path 가 비면 루트 목록을 반환.
   */
  @Get()
  async tree(@Query('path') queryPath?: string) {
    const roots = await this.prisma.libraryRoot.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { archives: true } } },
    });

    if (!queryPath) {
      return {
        path: null,
        roots: roots.map((r) => ({
          id: r.id,
          path: r.path,
          label: r.label,
          archiveCount: r._count.archives,
        })),
        children: [] as TreeNode[],
      };
    }

    const requested = resolve(queryPath);
    const matchedRoot = roots.find((r) => {
      const root = resolve(r.path);
      return requested === root || requested.startsWith(root + '/');
    });
    if (!matchedRoot) {
      throw new BadRequestException(
        '등록된 라이브러리 루트 밖의 경로는 접근할 수 없습니다.',
      );
    }

    let entries: { name: string; isDir: boolean }[];
    try {
      const dirents = await readdir(requested, { withFileTypes: true });
      entries = dirents
        .filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, isDir: true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      throw new BadRequestException(`경로를 읽을 수 없습니다: ${String(e)}`);
    }

    // 각 폴더 하위의 아카이브 카운트(재귀 prefix 매칭)
    const children: TreeNode[] = await Promise.all(
      entries.map(async (e) => {
        const childPath = join(requested, e.name);
        const count = await this.prisma.archive.count({
          where: {
            rootId: matchedRoot.id,
            path: { startsWith: childPath + '/' },
          },
        });
        return { name: e.name, path: childPath, archiveCount: count };
      }),
    );

    return {
      path: requested,
      rootId: matchedRoot.id,
      roots: roots.map((r) => ({
        id: r.id,
        path: r.path,
        label: r.label,
        archiveCount: r._count.archives,
      })),
      children,
    };
  }
}
