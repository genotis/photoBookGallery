import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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
          <img
            src={coverUrl(data.id, data.contentHash)}
            alt={data.title ?? data.fileName}
            loading="lazy"
          />
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
  random,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  /**
   * 랜덤 모드 — `{ seed, count }` 로 활성화. seed 가 바뀌면 새 배치를 가져온다.
   * null 이면 일반 필터/페이지네이션 모드.
   */
  random: { seed: number; count: number } | null;
}) {
  const [q, setQ] = useState(filters.q);
  const [viewer, setViewer] = useState<ArchiveListItem | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const browseQuery = useInfiniteQuery({
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
    enabled: random === null,
  });

  const randomQuery = useQuery({
    queryKey: ['archives-random', random?.seed, random?.count],
    queryFn: () => api.randomArchives(random!.count),
    enabled: random !== null,
    // 매 seed 변경마다 새 요청 → 캐시는 짧게.
    staleTime: 0,
    gcTime: 60_000,
  });

  const browseItems = useMemo(
    () => browseQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [browseQuery.data],
  );
  const randomItems = randomQuery.data?.items ?? [];
  const items = random !== null ? randomItems : browseItems;
  const total =
    random !== null
      ? randomItems.length
      : (browseQuery.data?.pages[0]?.total ?? 0);
  const isLoading = random !== null ? randomQuery.isLoading : browseQuery.isLoading;

  // 뷰어가 열린 상태에서 items 가 refetch 되면 (예: 재압축 후) 같은 id 의 새
  // 객체로 viewer 를 동기화한다. 그렇지 않으면 stale archive (옛 contentHash) 가
  // 계속 prop 으로 들어가 페이지 URL 이 갱신되지 않는다.
  useEffect(() => {
    if (!viewer) return;
    const fresh = items.find((it) => it.id === viewer.id);
    if (fresh && fresh !== viewer) {
      setViewer(fresh);
    }
  }, [items, viewer]);

  // Masonic 은 items 가 바뀌어도 내부 positioner 캐시를 재사용해 변경된 결과를
  // 렌더하지 않을 수 있다. 필터/정렬/랜덤 시드가 바뀔 때는 컴포넌트를 새로 마운트한다.
  const masonryKey = useMemo(
    () =>
      JSON.stringify({
        random: random ? { seed: random.seed, count: random.count } : null,
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
    [filters, random],
  );

  const loadMore = useInfiniteLoader(
    async () => {
      if (random !== null) return; // 랜덤 모드는 페이지네이션 없음
      if (browseQuery.hasNextPage && !browseQuery.isFetchingNextPage) {
        await browseQuery.fetchNextPage();
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
        {random !== null ? (
          <span className="random-badge">
            🎲 랜덤 <strong>{random.count}개</strong>
            <span className="muted small"> — 좌측 사이드바의 "랜덤" 메뉴를 다시 눌러 새로 섞기</span>
          </span>
        ) : (
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
        )}
        <select value={filters.sort} onChange={(e) => setSort(e.target.value)} disabled={random !== null}>
          <option value="createdAt">추가일순</option>
          <option value="name">이름순</option>
          <option value="mtime">수정일순</option>
          <option value="pageCount">페이지수순</option>
          <option value="rating">평점순</option>
        </select>
        <span className="count">{total}권</span>
      </div>

      {items.length === 0 && !isLoading ? (
        <p className="muted empty">
          {random !== null
            ? '랜덤으로 가져올 아카이브가 없습니다.'
            : '조건에 맞는 아카이브가 없습니다.'}
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

      {viewer &&
        (() => {
          const idx = items.findIndex((it) => it.id === viewer.id);
          const hasPrev = idx > 0;
          const hasNext = idx >= 0 && idx < items.length - 1;
          const navigateArchive = (delta: number) => {
            if (idx < 0) return;
            const target = items[idx + delta];
            if (target) setViewer(target);
            // 일반 모드에서 끝쪽으로 갈 때 다음 페이지를 선제적으로 받아둠 (랜덤은 페이지 없음).
            if (
              random === null &&
              delta > 0 &&
              idx + delta >= items.length - 5 &&
              browseQuery.hasNextPage &&
              !browseQuery.isFetchingNextPage
            ) {
              void browseQuery.fetchNextPage();
            }
          };
          return (
            <Viewer
              archive={viewer}
              onClose={() => setViewer(null)}
              // 뷰어를 닫지 않고 메타 패널을 위에 오버레이 → 닫으면 뷰어로 복귀.
              onEdit={() => setEditingId(viewer.id)}
              metaOpen={editingId !== null}
              onNavigateArchive={navigateArchive}
              hasPrev={hasPrev}
              hasNext={hasNext}
            />
          );
        })()}
      {editingId !== null && (
        <MetaPanel archiveId={editingId} onClose={() => setEditingId(null)} />
      )}
    </section>
  );
}
