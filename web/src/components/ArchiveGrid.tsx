import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Masonry, useInfiniteLoader } from 'masonic';
import { api, ArchiveListItem, coverUrl } from '../api';
import { Viewer } from './Viewer';

const OpenContext = createContext<(item: ArchiveListItem) => void>(() => {});

function Card({ data }: { index: number; data: ArchiveListItem; width: number }) {
  const open = useContext(OpenContext);
  return (
    <button className="card-cell" onClick={() => open(data)} title={data.fileName}>
      {data.hasCover ? (
        <img src={coverUrl(data.id)} alt={data.fileName} loading="lazy" />
      ) : (
        <div className="no-cover">표지 없음</div>
      )}
      <div className="card-caption">
        <span className="name">{data.fileName}</span>
        <span className="pages">{data.pageCount}p</span>
      </div>
    </button>
  );
}

export function ArchiveGrid() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [viewer, setViewer] = useState<ArchiveListItem | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['archives', { q: search, sort }],
    queryFn: ({ pageParam }) =>
      api.archives({ page: pageParam, limit: 60, q: search, sort, order: 'desc' }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  const loadMore = useInfiniteLoader(
    async () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        await query.fetchNextPage();
      }
    },
    { isItemLoaded: (i, loaded) => i < loaded.length, minimumBatchSize: 60, threshold: 8 },
  );

  const open = useCallback((item: ArchiveListItem) => setViewer(item), []);

  return (
    <section className="grid-wrap">
      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <input
            placeholder="파일명 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit">검색</button>
        </form>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="createdAt">추가일순</option>
          <option value="name">이름순</option>
          <option value="mtime">수정일순</option>
          <option value="pageCount">페이지수순</option>
        </select>
        <span className="count">{total}권</span>
      </div>

      {items.length === 0 && !query.isLoading ? (
        <p className="muted empty">
          아카이브가 없습니다. 좌측에서 루트를 추가하고 스캔하세요.
        </p>
      ) : (
        <OpenContext.Provider value={open}>
          <Masonry
            items={items}
            columnWidth={200}
            columnGutter={14}
            rowGutter={14}
            onRender={loadMore}
            render={Card}
            itemKey={(data) => data.id}
          />
        </OpenContext.Provider>
      )}

      {viewer && <Viewer archive={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
