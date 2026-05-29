import { useQuery } from '@tanstack/react-query';
import { api, Facets, ListParams } from '../api';
import { Filters } from './filters';
import { PathBrowser } from './PathBrowser';

export type FacetKey = 'country' | 'publisher' | 'series' | 'model' | 'tag';

const SECTIONS: {
  key: FacetKey;
  label: string;
  pick: (f: Facets) => { id: number; name: string; count: number }[];
}[] = [
  { key: 'model', label: '모델', pick: (f) => f.models },
  { key: 'publisher', label: '출판사', pick: (f) => f.publishers },
  {
    key: 'country',
    label: '국가',
    pick: (f) => f.countries.map((c) => ({ id: c.id, name: c.name, count: c.count })),
  },
  { key: 'series', label: '시리즈', pick: (f) => f.series },
  { key: 'tag', label: '태그', pick: (f) => f.tags },
];

export function FacetSidebar({
  filters,
  onToggle,
  onClear,
  onToggleFavorite,
  onSelectPath,
}: {
  filters: Filters;
  onToggle: (key: FacetKey, id: number) => void;
  onClear: () => void;
  onToggleFavorite: () => void;
  onSelectPath: (path: string | undefined) => void;
}) {
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

  const anyActive =
    [filters.country, filters.publisher, filters.series, filters.model, filters.tag]
      .some((arr) => arr && arr.length > 0) ||
    filters.favorite !== undefined ||
    filters.ratingMin !== undefined ||
    Boolean(filters.pathPrefix);

  return (
    <aside className="facets">
      <div className="facets-head">
        <h3>필터</h3>
        {anyActive && (
          <button className="ghost" onClick={onClear}>
            전체 해제
          </button>
        )}
      </div>

      <PathBrowser
        selectedPath={filters.pathPrefix}
        onSelect={onSelectPath}
      />

      <section className="facet-section">
        <h4>빠른 필터</h4>
        <ul>
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
      </section>

      {SECTIONS.map(({ key, label, pick }) => {
        const items = facets.data ? pick(facets.data) : [];
        if (items.length === 0) return null;
        const selected = new Set((filters[key] ?? []) as number[]);
        return (
          <section key={key} className="facet-section">
            <h4>{label}</h4>
            <ul>
              {items.map((it) => (
                <li key={it.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => onToggle(key, it.id)}
                    />
                    <span className="facet-name" title={it.name}>
                      {it.name}
                    </span>
                    <span className="facet-count">{it.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {facets.isLoading && <p className="muted">집계 중…</p>}
    </aside>
  );
}
