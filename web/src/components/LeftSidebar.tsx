import { useQuery } from '@tanstack/react-query';
import { api, Facets, ListParams } from '../api';
import { Filters } from './filters';
import { PathBrowser } from './PathBrowser';
import { useAppPrefs } from './useAppPrefs';

export type FacetKey = 'country' | 'publisher' | 'series' | 'model' | 'tag';

const FACET_SECTIONS: {
  key: FacetKey;
  label: string;
  pick: (f: Facets) => { id: number; name: string; count: number }[];
}[] = [
  { key: 'model', label: '모델', pick: (f) => f.models },
  { key: 'publisher', label: '출판사', pick: (f) => f.publishers },
  {
    key: 'country',
    label: '국가',
    pick: (f) =>
      f.countries.map((c) => ({ id: c.id, name: c.name, count: c.count })),
  },
  { key: 'series', label: '시리즈', pick: (f) => f.series },
  { key: 'tag', label: '태그', pick: (f) => f.tags },
];

/**
 * 좌측 통합 사이드바 — 내비게이션(전체/랜덤) + 필터(빠른필터·경로·패싯) + 설정.
 * 패싯 섹션은 `<details>` 로 접을 수 있어 메뉴가 묻히지 않도록 한다.
 */
export function LeftSidebar({
  active,
  onAll,
  onRandom,
  onModels,
  onSettings,
  filters,
  onToggleFacet,
  onClearFacets,
  onToggleFavorite,
  onSelectPath,
}: {
  active: 'browse' | 'random' | 'models';
  onAll: () => void;
  onRandom: () => void;
  onModels: () => void;
  onSettings: () => void;
  filters: Filters;
  onToggleFacet: (key: FacetKey, id: number) => void;
  onClearFacets: () => void;
  onToggleFavorite: () => void;
  onSelectPath: (path: string | undefined) => void;
}) {
  const [prefs] = useAppPrefs();

  const params: Omit<ListParams, 'page' | 'limit' | 'sort' | 'order'> = {
    q: filters.q,
    favorite: filters.favorite,
    ratingMin: filters.ratingMin,
    country: filters.country,
    publisher: filters.publisher,
    series: filters.series,
    model: filters.model,
    tag: filters.tag,
    pathPrefix: filters.pathPrefix,
  };
  const facets = useQuery({
    queryKey: ['facets', params],
    queryFn: () => api.facets(params),
  });

  const activeFilterCount =
    (filters.country?.length ?? 0) +
    (filters.publisher?.length ?? 0) +
    (filters.series?.length ?? 0) +
    (filters.model?.length ?? 0) +
    (filters.tag?.length ?? 0) +
    (filters.favorite !== undefined ? 1 : 0) +
    (filters.ratingMin !== undefined ? 1 : 0) +
    (filters.pathPrefix ? 1 : 0);
  const isPristine = active === 'browse' && activeFilterCount === 0;

  return (
    <aside className="left-sidebar" aria-label="내비게이션 / 필터">
      <nav className="left-nav">
        <button
          type="button"
          className={`left-nav-item ${isPristine ? 'on' : ''}`}
          onClick={onAll}
          title={
            activeFilterCount > 0
              ? '랜덤 모드 종료 + 모든 필터 해제'
              : '필터 없이 전체 보기'
          }
        >
          <span className="left-nav-icon" aria-hidden>📚</span>
          <span className="left-nav-label">전체 보기</span>
          {activeFilterCount > 0 && (
            <span className="left-nav-count" title={`${activeFilterCount}개 필터 적용 중`}>
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`left-nav-item ${active === 'random' ? 'on' : ''}`}
          onClick={onRandom}
          title={
            active === 'random'
              ? `다시 섞기 (${prefs.randomCount}개)`
              : `랜덤 ${prefs.randomCount}개 보기`
          }
        >
          <span className="left-nav-icon" aria-hidden>🎲</span>
          <span className="left-nav-label">
            랜덤 <span className="muted small">{prefs.randomCount}개</span>
          </span>
        </button>
        <button
          type="button"
          className={`left-nav-item ${active === 'models' ? 'on' : ''}`}
          onClick={onModels}
          title="모델별 브라우징"
        >
          <span className="left-nav-icon" aria-hidden>👤</span>
          <span className="left-nav-label">모델</span>
        </button>
      </nav>

      <div className="left-section">
        <div className="left-section-head">
          <h4>필터</h4>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={onClearFacets}
              title="모든 필터 해제"
            >
              전체 해제
            </button>
          )}
        </div>

        <ul className="facet-list">
          <li>
            <label>
              <input
                type="checkbox"
                checked={filters.favorite === true}
                onChange={onToggleFavorite}
              />
              <span className="facet-name">즐겨찾기만</span>
            </label>
          </li>
        </ul>

        <details className="facet-collapse" open>
          <summary>경로</summary>
          <PathBrowser
            selectedPath={filters.pathPrefix}
            onSelect={onSelectPath}
          />
        </details>

        {FACET_SECTIONS.map(({ key, label, pick }) => {
          const items = facets.data ? pick(facets.data) : [];
          if (items.length === 0) return null;
          const selected = new Set((filters[key] ?? []) as number[]);
          const count = selected.size;
          return (
            <details
              key={key}
              className="facet-collapse"
              open={count > 0 || items.length <= 6}
            >
              <summary>
                {label}
                {count > 0 && <span className="left-nav-count">{count}</span>}
              </summary>
              <ul className="facet-list">
                {items.map((it) => (
                  <li key={it.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => onToggleFacet(key, it.id)}
                      />
                      <span className="facet-name" title={it.name}>
                        {it.name}
                      </span>
                      <span className="facet-count">{it.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}

        {facets.isLoading && <p className="muted small">집계 중…</p>}
      </div>

      <div className="left-nav-divider" />
      <nav className="left-nav">
        <button
          type="button"
          className="left-nav-item"
          onClick={onSettings}
          title="설정 열기"
        >
          <span className="left-nav-icon" aria-hidden>⚙</span>
          <span className="left-nav-label">설정</span>
        </button>
      </nav>
    </aside>
  );
}
