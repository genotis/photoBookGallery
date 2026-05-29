import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Masonry, useInfiniteLoader } from 'masonic';
import { api, ArchiveListItem, coverUrl } from '../api';
import { Filters } from './filters';
import { Viewer } from './Viewer';
import { MetaPanel } from './MetaPanel';

interface CardActions {
  open: (item: ArchiveListItem) => void;
  edit: (item: ArchiveListItem) => void;
}
const ActionsContext = createContext<CardActions>({ open: () => {}, edit: () => {} });

function Card({ data }: { index: number; data: ArchiveListItem; width: number }) {
  const { open, edit } = useContext(ActionsContext);
  return (
    <div className="card-cell" title={data.fileName}>
      <button
        className="card-meta"
        onClick={(e) => {
          e.stopPropagation();
          edit(data);
        }}
        title="메타 편집"
      >
        ⋯
      </button>
      <button className="card-open" onClick={() => open(data)}>
        {data.hasCover ? (
          <img src={coverUrl(data.id)} alt={data.title ?? data.fileName} loading="lazy" />
        ) : (
          <div className="no-cover">표지 없음</div>
        )}
        <div className="card-caption">
          <span className="name">
            {data.favorite && <span className="fav">★ </span>}
            {data.title || data.fileName}
          </span>
          <span className="pages">{data.pageCount}p</span>
        </div>
      </button>
    </div>
  );
}

export function ArchiveGrid({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
}) {
  const [q, setQ] = useState(filters.q);
  const [viewer, setViewer] = useState<ArchiveListItem | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['archives', filters],
    queryFn: ({ pageParam }) =>
      api.archives({
        page: pageParam,
        limit: 60,
        q: filters.q,
        sort: filters.sort,
        order: filters.order,
        favorite: filters.favorite,
        ratingMin: filters.ratingMin,
        country: filters.country,
        publisher: filters.publisher,
        series: filters.series,
        model: filters.model,
        tag: filters.tag,
        pathPrefix: filters.pathPrefix,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  // Masonic 은 items 가 바뀌어도 내부 positioner 캐시를 재사용해 변경된 결과를
  // 렌더하지 않을 수 있다. 필터/정렬이 바뀔 때는 컴포넌트를 새로 마운트한다.
  const masonryKey = useMemo(
    () =>
      JSON.stringify({
        q: filters.q,
        sort: filters.sort,
        order: filters.order,
        fav: filters.favorite ?? null,
        rmin: filters.ratingMin ?? null,
        co: filters.country ?? null,
        pu: filters.publisher ?? null,
        se: filters.series ?? null,
        mo: filters.model ?? null,
        ta: filters.tag ?? null,
        pp: filters.pathPrefix ?? null,
      }),
    [filters],
  );

  const loadMore = useInfiniteLoader(
    async () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        await query.fetchNextPage();
      }
    },
    { isItemLoaded: (i, loaded) => i < loaded.length, minimumBatchSize: 60, threshold: 8 },
  );

  const actions = useMemo<CardActions>(
    () => ({
      open: (item) => setViewer(item),
      edit: (item) => setEditingId(item.id),
    }),
    [],
  );

  const setSort = useCallback(
    (sort: string) => setFilters({ ...filters, sort }),
    [filters, setFilters],
  );

  return (
    <section className="grid-wrap">
      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...filters, q: q.trim() });
          }}
        >
          <input
            placeholder="파일명·메모 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit">검색</button>
        </form>
        <select value={filters.sort} onChange={(e) => setSort(e.target.value)}>
          <option value="createdAt">추가일순</option>
          <option value="name">이름순</option>
          <option value="mtime">수정일순</option>
          <option value="pageCount">페이지수순</option>
          <option value="rating">평점순</option>
        </select>
        <span className="count">{total}권</span>
      </div>

      {items.length === 0 && !query.isLoading ? (
        <p className="muted empty">
          조건에 맞는 아카이브가 없습니다.
        </p>
      ) : (
        <ActionsContext.Provider value={actions}>
          <Masonry
            key={masonryKey}
            items={items}
            columnWidth={200}
            columnGutter={14}
            rowGutter={14}
            onRender={loadMore}
            render={Card}
            itemKey={(data) => data.id}
          />
        </ActionsContext.Provider>
      )}

      {viewer && (
        <Viewer
          archive={viewer}
          onClose={() => setViewer(null)}
          onEdit={() => {
            setEditingId(viewer.id);
            setViewer(null);
          }}
        />
      )}
      {editingId !== null && (
        <MetaPanel archiveId={editingId} onClose={() => setEditingId(null)} />
      )}
    </section>
  );
}
