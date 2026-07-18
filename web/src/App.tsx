import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { ArchiveGrid } from './components/ArchiveGrid';
import { ModelGallery } from './components/ModelGallery';
import { FacetKey, LeftSidebar } from './components/LeftSidebar';
import { Filters, INITIAL_FILTERS, toggleId } from './components/filters';
import { useAppPrefs } from './components/useAppPrefs';

const SIDEBAR_AUTO_THRESHOLD = 960;

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
  const [leftOpen, setLeftOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= SIDEBAR_AUTO_THRESHOLD;
  });
  /** 랜덤 모드 — 0 이면 비활성, 양수면 그 시드값으로 활성. 클릭마다 +1 → 재섞기. */
  const [randomSeed, setRandomSeed] = useState<number>(0);
  /** 모델별 브라우징 뷰 활성 여부. */
  const [modelsView, setModelsView] = useState(false);
  const [appPrefs] = useAppPrefs();

  // sticky 헤더의 실제 높이를 측정해 CSS 변수에 반영 — 패싯 사이드바가 정확히
  // 헤더 아래에 stick 하도록. safe-area-inset 변화/회전에도 대응.
  const headerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--header-h', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [me.data?.authenticated, settingsOpen]);

  if (me.isLoading) {
    return <main className="center">로딩 중…</main>;
  }

  if (!me.data?.authenticated) {
    return <Login onSuccess={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  }

  const ok = health.data?.status === 'ok' && health.data?.db === 'up';
  const hasRoots = (roots.data?.length ?? 0) > 0;

  const toggleFacet = (key: FacetKey, id: number) => {
    setModelsView(false);
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

  /** "전체 보기" — 랜덤·모델 뷰 종료 + 모든 필터 해제 (정렬/검색어는 유지). */
  const goAll = () => {
    setRandomSeed(0);
    setModelsView(false);
    clearFacets();
  };

  return (
    <div className="app">
      <header className="app-bar" ref={headerRef}>
        <button
          className="ghost icon-only"
          onClick={() => setLeftOpen((v) => !v)}
          aria-label={leftOpen ? '메뉴 숨김' : '메뉴 열기'}
          title={leftOpen ? '메뉴 숨김' : '메뉴 열기'}
        >
          ☰
        </button>
        <h1>photoBookGallery</h1>
        <div className="app-bar-right">
          <span className={`badge ${ok ? 'ok' : 'down'}`}>
            DB {health.data?.db ?? '?'}
          </span>
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
        {hasRoots && leftOpen && (
          <LeftSidebar
            active={
              modelsView ? 'models' : randomSeed > 0 ? 'random' : 'browse'
            }
            onAll={goAll}
            onRandom={() => {
              setModelsView(false);
              setRandomSeed((s) => s + 1);
            }}
            onModels={() => {
              setRandomSeed(0);
              setModelsView(true);
            }}
            onSettings={() => setSettingsOpen(true)}
            filters={filters}
            onToggleFacet={toggleFacet}
            onClearFacets={clearFacets}
            onToggleFavorite={() => {
              setModelsView(false);
              setFilters({
                ...filters,
                favorite: filters.favorite ? undefined : true,
              });
            }}
            onSelectPath={(p) => {
              setModelsView(false);
              setFilters({ ...filters, pathPrefix: p });
            }}
          />
        )}
        {hasRoots && modelsView ? (
          <ModelGallery
            onSelect={(id) => {
              setModelsView(false);
              setRandomSeed(0);
              setFilters({ ...INITIAL_FILTERS, model: [id] });
            }}
          />
        ) : hasRoots ? (
          <ArchiveGrid
            filters={filters}
            setFilters={setFilters}
            random={
              randomSeed > 0
                ? { seed: randomSeed, count: appPrefs.randomCount }
                : null
            }
          />
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
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
