import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { ArchiveGrid } from './components/ArchiveGrid';
import { FacetKey, FacetSidebar } from './components/FacetSidebar';
import { Filters, INITIAL_FILTERS, toggleId } from './components/filters';

const FACET_AUTO_THRESHOLD = 960;

function getInitialFacets(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= FACET_AUTO_THRESHOLD;
}

export function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const roots = useQuery({
    queryKey: ['roots'],
    queryFn: api.roots,
    enabled: me.data?.authenticated === true,
  });

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [facetsOpen, setFacetsOpen] = useState(getInitialFacets);

  // 사용자가 명시적으로 토글했는지 추적 — 회전 시 자동 전환은 사용자가 손대지
  // 않은 경우에만. 사용자가 한 번 닫으면(또는 열면) 회전해도 그 의도를 유지.
  const facetsUserOverride = useRef(false);
  useEffect(() => {
    const onResize = () => {
      if (facetsUserOverride.current) return;
      const next = window.innerWidth >= FACET_AUTO_THRESHOLD;
      setFacetsOpen((cur) => (cur === next ? cur : next));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const toggleFacets = () => {
    facetsUserOverride.current = true;
    setFacetsOpen((v) => !v);
  };

  if (me.isLoading) {
    return <main className="center">로딩 중…</main>;
  }

  if (!me.data?.authenticated) {
    return <Login onSuccess={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  }

  const ok = health.data?.status === 'ok' && health.data?.db === 'up';
  const hasRoots = (roots.data?.length ?? 0) > 0;

  const toggleFacet = (key: FacetKey, id: number) => {
    setFilters({ ...filters, [key]: toggleId(filters[key], id) });
  };

  const clearFacets = () => {
    setFilters({
      ...filters,
      country: undefined,
      publisher: undefined,
      series: undefined,
      model: undefined,
      tag: undefined,
      favorite: undefined,
      ratingMin: undefined,
      pathPrefix: undefined,
    });
  };

  return (
    <div className="app">
      <header className="app-bar">
        <h1>photoBookGallery</h1>
        <div className="app-bar-right">
          <span className={`badge ${ok ? 'ok' : 'down'}`}>
            DB {health.data?.db ?? '?'}
          </span>
          {hasRoots && (
            <button className="ghost" onClick={toggleFacets}>
              {facetsOpen ? '필터 숨김' : '필터 ▾'}
            </button>
          )}
          <button className="ghost" onClick={() => setSettingsOpen(true)}>
            ⚙ 설정
          </button>
          <button
            className="ghost"
            onClick={async () => {
              await api.logout();
              qc.invalidateQueries({ queryKey: ['me'] });
            }}
          >
            로그아웃
          </button>
        </div>
      </header>
      <div className="app-body">
        {hasRoots ? (
          <ArchiveGrid filters={filters} setFilters={setFilters} />
        ) : (
          <section className="grid-wrap">
            <div className="empty-onboarding">
              <h2>아직 라이브러리 루트가 없습니다.</h2>
              <p className="muted">
                설정에서 스캔할 폴더 경로를 등록하면 인덱서가 zip/cbz/rar/cbr 파일을
                찾아 갤러리에 표시합니다.
              </p>
              <button onClick={() => setSettingsOpen(true)}>
                설정 열기
              </button>
            </div>
          </section>
        )}
        {hasRoots && facetsOpen && (
          <FacetSidebar
            filters={filters}
            onToggle={toggleFacet}
            onClear={clearFacets}
            onToggleFavorite={() =>
              setFilters({
                ...filters,
                favorite: filters.favorite ? undefined : true,
              })
            }
            onSelectPath={(p) => setFilters({ ...filters, pathPrefix: p })}
          />
        )}
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
