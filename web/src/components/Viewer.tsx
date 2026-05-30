import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ArchiveListItem, pageUrl } from '../api';
import { useJobStream } from './useJobStream';
import { useViewerBehavior } from './useViewerBehavior';

type ViewMode = 'single' | 'scroll-v' | 'scroll-h';
type FitMode = 'screen' | 'width' | 'height' | 'original';
type ReadDir = 'ltr' | 'rtl';

const VIEW_MODES: ViewMode[] = ['single', 'scroll-v', 'scroll-h'];
const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  single: '단일 페이지',
  'scroll-v': '세로 연속',
  'scroll-h': '가로 연속',
};
// 클래스명으로 SVG 같은 아이콘을 그리기 위한 키. 실제 그림은 CSS 가 담당.
const VIEW_MODE_ICON_CLASS: Record<ViewMode, string> = {
  single: 'i-page',
  'scroll-v': 'i-scroll-v',
  'scroll-h': 'i-scroll-h',
};

const FIT_MODES: FitMode[] = ['screen', 'width', 'height', 'original'];
const FIT_MODE_LABEL: Record<FitMode, string> = {
  screen: '화면맞춤',
  width: '너비맞춤',
  height: '높이맞춤',
  original: '원본 크기 (1:1)',
};
const FIT_MODE_ICON_CLASS: Record<FitMode, string> = {
  screen: 'i-fit-screen',
  width: 'i-fit-w',
  height: 'i-fit-h',
  original: 'i-fit-1',
};

const STORAGE_KEY = 'pbg.viewerPrefs.v2';

interface Prefs {
  view: ViewMode;
  fit: FitMode;
  dir: ReadDir;
}

function loadPrefs(): Prefs {
  const defaults: Prefs = { view: 'single', fit: 'screen', dir: 'ltr' };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      view: VIEW_MODES.includes(p.view as ViewMode) ? (p.view as ViewMode) : defaults.view,
      fit: FIT_MODES.includes(p.fit as FitMode) ? (p.fit as FitMode) : defaults.fit,
      dir: p.dir === 'rtl' ? 'rtl' : 'ltr',
    };
  } catch {
    return defaults;
  }
}

function savePrefs(p: Prefs): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export function Viewer({
  archive,
  onClose,
  onEdit,
  onNavigateArchive,
  hasPrev = false,
  hasNext = false,
}: {
  archive: ArchiveListItem;
  onClose: () => void;
  onEdit?: () => void;
  /** 부모(그리드)가 정의한 prev/next 사진집으로 이동 */
  onNavigateArchive?: (delta: number) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  const qc = useQueryClient();
  const entries = useQuery({
    queryKey: ['entries', archive.id],
    queryFn: () => api.entries(archive.id),
  });
  const total = entries.data?.length ?? archive.pageCount;

  const initialPrefs = useMemo(loadPrefs, []);
  const [view, setView] = useState<ViewMode>(initialPrefs.view);
  const [fit, setFit] = useState<FitMode>(initialPrefs.fit);
  const [dir, setDir] = useState<ReadDir>(initialPrefs.dir);
  useEffect(() => savePrefs({ view, fit, dir }), [view, fit, dir]);

  const [behavior] = useViewerBehavior();

  const [index, setIndex] = useState(0);

  // 선택 모드 (삭제 후 재압축)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // 스크롤 컨테이너 ref — 키보드/스와이프 nav 시 명시적 scrollIntoView
  const scrollHRef = useRef<HTMLDivElement | null>(null);
  const scrollVRef = useRef<HTMLDivElement | null>(null);
  // 하단 썸네일 스트립 ref — 현재 페이지가 항상 가운데에 보이도록 자동 정렬
  const thumbsRef = useRef<HTMLDivElement | null>(null);

  // 사진집이 바뀌면 페이지·선택 상태 초기화 + 스크롤 위치 리셋
  useEffect(() => {
    setIndex(0);
    setSelected(new Set());
    setSelectMode(false);
    scrollVRef.current?.scrollTo({ top: 0 });
    scrollHRef.current?.scrollTo({ left: 0 });
  }, [archive.id]);

  /** 명시적 nav (키보드/스와이프/버튼). 스크롤 컨테이너 동기화 포함. */
  const navTo = useCallback(
    (next: number) => {
      const clamped = Math.min(total - 1, Math.max(0, next));
      setIndex(clamped);
      if (view === 'scroll-h') {
        scrollHRef.current?.children[clamped]?.scrollIntoView({
          inline: 'start',
          block: 'nearest',
          behavior: 'smooth',
        });
      } else if (view === 'scroll-v') {
        scrollVRef.current?.children[clamped]?.scrollIntoView({
          block: 'start',
          behavior: 'smooth',
        });
      }
    },
    [total, view],
  );

  const go = useCallback(
    (delta: number) => navTo(index + delta),
    [index, navTo],
  );

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  // 키보드 — RTL 일 때 좌우 의미 반전
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectMode) {
          setSelectMode(false);
          setSelected(new Set());
        } else {
          onClose();
        }
        return;
      }
      // 사진집 이동 — `[` 이전, `]` 다음 (페이지 위치와 무관)
      if (e.key === '[' && hasPrev && onNavigateArchive) {
        onNavigateArchive(-1);
        return;
      }
      if (e.key === ']' && hasNext && onNavigateArchive) {
        onNavigateArchive(1);
        return;
      }
      const horizontal = view === 'single' || view === 'scroll-h';
      if (!horizontal) return;
      const fwd = dir === 'rtl' ? -1 : 1;
      if (e.key === 'ArrowRight') go(fwd);
      else if (e.key === 'ArrowLeft') go(-fwd);
      else if (e.key === ' ' || e.key === 'PageDown') go(1); // 진행 방향 무관: 다음 페이지
      else if (e.key === 'PageUp') go(-1);
      else if (selectMode && (e.key === 'x' || e.key === 'X')) toggle(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dir, go, index, view, onClose, selectMode, toggle, hasPrev, hasNext, onNavigateArchive]);

  // 프리로딩 (단일/가로 모드) — 인접 페이지 즉시
  useEffect(() => {
    if (view === 'scroll-v') return;
    [index + 1, index + 2, index - 1].forEach((i) => {
      if (i >= 0 && i < total) {
        const img = new Image();
        img.src = pageUrl(archive.id, i);
      }
    });
  }, [archive.id, index, view, total]);

  // 사진집이 열리면 전체 페이지를 순서대로 백그라운드 캐시에 채운다.
  // 한 페이지 로드 완료 후 다음 시작 — 동시 요청을 1개로 제한해 첫 페이지의
  // 즉시성을 보장 + 네트워크/서버 부담 분산.
  useEffect(() => {
    if (total === 0) return;
    let cancelled = false;
    let cur = 0;
    const next = () => {
      if (cancelled || cur >= total) return;
      const i = cur++;
      const img = new Image();
      const done = () => {
        if (!cancelled) next();
      };
      img.onload = done;
      img.onerror = done;
      img.src = pageUrl(archive.id, i);
    };
    next();
    return () => {
      cancelled = true;
    };
  }, [archive.id, total]);

  // 썸네일 스트립 — 현재 index 가 바뀔 때마다 가운데로 정렬
  useEffect(() => {
    const child = thumbsRef.current?.children[index] as HTMLElement | undefined;
    child?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index]);

  // 썸네일 hover 효과는 CSS 만으로 처리 (.thumb:hover).
  // 누적 translateX 기반 dock 매그니피케이션은 부동소수점/sub-pixel 오차로
  // 인접 썸네일 사이 미세 겹침이 반복되어, 순수 CSS layout 으로 회귀했다:
  //   - hovered thumb 은 scale + 좌우 margin 으로 자체 공간 확보
  //   - flex layout 이 spacing 을 강제 → 절대 겹치지 않음
  //   - transition 이 부드럽게 보간

  // 보기 모드가 바뀌면 현재 index 위치로 스크롤 동기화 (한 번만)
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    const i = indexRef.current;
    if (view === 'scroll-h') {
      scrollHRef.current?.children[i]?.scrollIntoView({ inline: 'start', block: 'nearest' });
    } else if (view === 'scroll-v') {
      scrollVRef.current?.children[i]?.scrollIntoView({ block: 'start' });
    }
  }, [view]);

  // 스크롤 모드: IntersectionObserver 로 화면에서 가장 잘 보이는 페이지를 추적해
  // 페이지 번호를 갱신. 명시적 nav 와는 별개 경로라 루프 없음.
  useEffect(() => {
    if (view === 'single') return;
    const container = view === 'scroll-h' ? scrollHRef.current : scrollVRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const best = visible.reduce((a, b) =>
          a.intersectionRatio >= b.intersectionRatio ? a : b,
        );
        const idx = children.indexOf(best.target as HTMLElement);
        if (idx >= 0) setIndex((cur) => (cur === idx ? cur : idx));
      },
      { root: container, threshold: [0.25, 0.5, 0.75, 1] },
    );
    children.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [view, total, archive.id]);

  // 터치 스와이프 + nav 버튼 클릭 억제용 공유 상태.
  // 사용자가 손가락을 끌면 swipedRef = true 가 되어 직후 발생할 합성 click 을
  // nav 버튼이 무시한다 (스와이프 우선).
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipedRef = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    if (selectMode) return;
    swipedRef.current = false;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      swipedRef.current = true;
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (view !== 'single' || selectMode) return;
    if (Math.abs(dx) < 50) return;
    swipedRef.current = true; // 명시적 swipe — 직후 합성 click 차단
    const fwd = dir === 'rtl' ? 1 : -1;
    go(dx * fwd < 0 ? 1 : -1);
  };
  const navIfNotSwiped = useCallback(
    (delta: number) => {
      if (swipedRef.current) {
        swipedRef.current = false;
        return;
      }
      go(delta);
    },
    [go],
  );

  // 슬라이드쇼 — 설정 간격마다 다음 페이지로 자동 진행. 마지막 페이지에서 자동 정지.
  const [slideshow, setSlideshow] = useState(false);
  useEffect(() => {
    if (!slideshow || total === 0) return;
    const ms = Math.max(1, behavior.slideshowSec) * 1000;
    const timer = window.setTimeout(() => {
      if (index < total - 1) {
        navTo(index + 1);
      } else {
        setSlideshow(false);
      }
    }, ms);
    return () => window.clearTimeout(timer);
  }, [slideshow, index, total, behavior.slideshowSec, navTo]);
  // 사진집/뷰가 바뀌면 슬라이드쇼 자동 종료
  useEffect(() => {
    setSlideshow(false);
  }, [archive.id]);
  const toggleSlideshow = () => setSlideshow((v) => !v);

  // 전체화면 토글 (Fullscreen API). iPad Safari 는 미지원 — 홈화면 추가 PWA 가 대안.
  const [isFs, setIsFs] = useState(
    typeof document !== 'undefined' && !!document.fullscreenElement,
  );
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // 브라우저가 거부하거나 미지원 — 무시
    }
  };

  // 상단바 자동 숨김
  const [barVisible, setBarVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const revealBar = useCallback(() => {
    setBarVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (selectMode) return;
    hideTimer.current = window.setTimeout(() => setBarVisible(false), 2200);
  }, [selectMode]);
  useEffect(() => {
    revealBar();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [revealBar]);

  /**
   * 중앙 이미지 영역 더블클릭 → 상단바 + 하단 썸네일 네비를 토글.
   * 선택 모드에서는 카드 더블클릭이 selection toggle 과 충돌하므로 비활성.
   */
  const toggleBarManual = useCallback(() => {
    if (selectMode) return;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setBarVisible((v) => !v);
  }, [selectMode]);

  // 중앙 영역 더블탭/더블클릭 감지 — iPad Safari 는 onDoubleClick 이 신뢰성
  // 떨어져 click 두 번을 직접 측정한다. 좌/우 nav 버튼 click 은 frame 의 sibling
  // 이라 frame 의 onClick 으로 bubble 되지 않으므로 자연스럽게 제외됨.
  const lastCenterTapRef = useRef<{ t: number; x: number; y: number } | null>(
    null,
  );
  const onCenterClick = useCallback(
    (e: React.MouseEvent) => {
      if (selectMode) return;
      // 스와이프로 끝난 경우의 합성 click 은 무시
      if (swipedRef.current) {
        swipedRef.current = false;
        return;
      }
      const now = Date.now();
      const x = e.clientX;
      const y = e.clientY;
      const last = lastCenterTapRef.current;
      if (
        last &&
        now - last.t < 350 &&
        Math.abs(x - last.x) < 40 &&
        Math.abs(y - last.y) < 40
      ) {
        lastCenterTapRef.current = null;
        toggleBarManual();
      } else {
        lastCenterTapRef.current = { t: now, x, y };
      }
    },
    [selectMode, toggleBarManual],
  );

  // ---- 재압축 ----
  const [activeJob, setActiveJob] = useState<number | null>(null);
  const repack = useMutation({
    mutationFn: () => {
      const names = (entries.data ?? [])
        .filter((e) => selected.has(e.order))
        .map((e) => e.name);
      return api.repack(archive.id, names);
    },
    onSuccess: (res) => setActiveJob(res.jobId),
  });
  const job = useJobStream(activeJob);
  const jobStatus = job?.status;
  useEffect(() => {
    if (jobStatus === 'done') {
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['archive', archive.id] });
      qc.invalidateQueries({ queryKey: ['entries', archive.id] });
      qc.invalidateQueries({ queryKey: ['facets'] });
      onClose();
    }
  }, [jobStatus, qc, archive.id, onClose]);

  const selectedCount = selected.size;
  const repackPending =
    repack.isPending ||
    (jobStatus !== undefined && jobStatus !== 'done' && jobStatus !== 'failed');

  const startRepack = () => {
    if (selectedCount === 0) return;
    if (selectedCount === total) {
      alert('모든 페이지를 제외할 수 없습니다.');
      return;
    }
    const pageNumbers = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => i + 1)
      .join(', ');
    const ok = window.confirm(
      `다음 ${selectedCount}개 페이지를 삭제합니다:\n  ${pageNumbers}\n\n` +
        '원본은 백업 경로로 보관되고, 새 .cbz 가 활성 위치에 배치됩니다. 계속할까요?',
    );
    if (ok) repack.mutate();
  };

  const isSelected = useMemo(() => (i: number) => selected.has(i), [selected]);
  const showDirToggle = view === 'single' || view === 'scroll-h';

  return (
    <div
      className={`viewer view-${view} fit-${fit} dir-${dir} ${
        behavior.tapNav ? 'tap-nav' : ''
      }`}
      // DevTools 에서 현재 동작 설정 확인용
      data-tap-nav={behavior.tapNav}
      data-reveal={behavior.reveal}
      onClick={onClose}
      onMouseMove={
        behavior.reveal === 'motion' || behavior.reveal === 'both'
          ? revealBar
          : undefined
      }
      onTouchStart={
        behavior.reveal === 'motion' || behavior.reveal === 'both'
          ? revealBar
          : undefined
      }
    >
      <header
        className={`viewer-bar ${barVisible || selectMode || repackPending ? '' : 'hidden'}`}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="vb-left">
          <button className="vb-icon vb-close" onClick={onClose} title="닫기 (Esc)">
            ✕
          </button>
          <button
            className="vb-icon"
            onClick={toggleFullscreen}
            title={isFs ? '전체화면 해제' : '전체화면'}
            aria-label={isFs ? '전체화면 해제' : '전체화면'}
          >
            <span className={`vb-ico ${isFs ? 'i-fs-exit' : 'i-fs-enter'}`} />
          </button>
          {onNavigateArchive && (
            <div className="vb-seg" role="group" aria-label="사진집 이동">
              <button
                className="vb-seg-item"
                onClick={() => onNavigateArchive(-1)}
                disabled={!hasPrev}
                title="이전 사진집 ( [ )"
                aria-label="이전 사진집"
              >
                <span className="vb-ico i-archive-prev" />
              </button>
              <button
                className="vb-seg-item"
                onClick={() => onNavigateArchive(1)}
                disabled={!hasNext}
                title="다음 사진집 ( ] )"
                aria-label="다음 사진집"
              >
                <span className="vb-ico i-archive-next" />
              </button>
            </div>
          )}
          <span className="vb-title" title={archive.fileName}>
            {archive.title || archive.fileName}
          </span>
        </div>

        <div className="vb-center">
          {!selectMode && total > 0 && (
            <span className="vb-page">
              <strong>{index + 1}</strong>
              <span className="vb-page-sep">/</span>
              <span className="vb-page-total">{total}</span>
            </span>
          )}
          {selectMode && (
            <span className="vb-page selecting">{selectedCount}개 선택</span>
          )}
        </div>

        <div className="vb-right">
          {showDirToggle && (
            <div className="vb-seg" role="group" aria-label="읽기 방향">
              <button
                className={`vb-seg-item ${dir === 'ltr' ? 'on' : ''}`}
                onClick={() => setDir('ltr')}
                title="왼쪽 → 오른쪽 (LTR)"
                aria-label="왼쪽 → 오른쪽"
                aria-pressed={dir === 'ltr'}
              >
                <span className="vb-ico i-dir-ltr" />
              </button>
              <button
                className={`vb-seg-item ${dir === 'rtl' ? 'on' : ''}`}
                onClick={() => setDir('rtl')}
                title="오른쪽 → 왼쪽 (RTL)"
                aria-label="오른쪽 → 왼쪽"
                aria-pressed={dir === 'rtl'}
              >
                <span className="vb-ico i-dir-rtl" />
              </button>
            </div>
          )}

          <div className="vb-seg" role="group" aria-label="화면 fit">
            {FIT_MODES.map((m) => (
              <button
                key={m}
                className={`vb-seg-item ${fit === m ? 'on' : ''}`}
                onClick={() => setFit(m)}
                title={FIT_MODE_LABEL[m]}
                aria-label={FIT_MODE_LABEL[m]}
                aria-pressed={fit === m}
              >
                <span className={`vb-ico ${FIT_MODE_ICON_CLASS[m]}`} />
              </button>
            ))}
          </div>

          <div className="vb-seg" role="group" aria-label="보기 모드">
            {VIEW_MODES.map((m) => (
              <button
                key={m}
                className={`vb-seg-item ${view === m ? 'on' : ''}`}
                onClick={() => setView(m)}
                title={VIEW_MODE_LABEL[m]}
                aria-label={VIEW_MODE_LABEL[m]}
                aria-pressed={view === m}
              >
                <span className={`vb-ico ${VIEW_MODE_ICON_CLASS[m]}`} />
              </button>
            ))}
          </div>

          <div className="vb-group">
            {selectMode ? (
              <>
                <button
                  className="vb-action vb-danger"
                  onClick={startRepack}
                  disabled={selectedCount === 0 || repackPending}
                >
                  {repackPending ? '재압축 중…' : '삭제 후 재압축'}
                </button>
                <button
                  className="vb-action"
                  onClick={() => {
                    setSelectMode(false);
                    setSelected(new Set());
                  }}
                  disabled={repackPending}
                >
                  완료
                </button>
              </>
            ) : (
              <>
                <button
                  className={`vb-action vb-slideshow ${slideshow ? 'on' : ''}`}
                  onClick={toggleSlideshow}
                  title={
                    slideshow
                      ? '슬라이드쇼 정지'
                      : `슬라이드쇼 시작 (${behavior.slideshowSec}초 간격)`
                  }
                  aria-label={slideshow ? '슬라이드쇼 정지' : '슬라이드쇼 시작'}
                  disabled={total < 2}
                >
                  <span
                    className={`vb-ico ${slideshow ? 'i-pause' : 'i-play'}`}
                  />
                </button>
                {onEdit && (
                  <button className="vb-action" onClick={onEdit} title="메타 편집">
                    메타
                  </button>
                )}
                <button
                  className="vb-action"
                  onClick={() => setSelectMode(true)}
                  title="페이지 선택 모드"
                >
                  선택
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {repackPending && (
        <div className="repack-progress">
          재압축 작업 진행 중… {Math.round((job?.progress ?? 0) * 100)}%
        </div>
      )}
      {jobStatus === 'failed' && (
        <div className="repack-progress error">재압축 실패: {job?.error}</div>
      )}

      {view === 'single' ? (
        <div
          className="viewer-single"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <button
            className="nav prev"
            onClick={() => navIfNotSwiped(dir === 'rtl' ? 1 : -1)}
            onDoubleClick={(e) => e.stopPropagation()}
            disabled={dir === 'rtl' ? index >= total - 1 : index === 0}
            aria-label="이전 페이지"
          />
          {total > 0 ? (
            <div
              className={`viewer-frame ${selectMode ? 'selectable' : ''} ${
                isSelected(index) ? 'selected' : ''
              }`}
              onClick={
                selectMode ? () => toggle(index) : onCenterClick
              }
            >
              <img
                key={index}
                className="viewer-img"
                src={pageUrl(archive.id, index)}
                alt={`page ${index + 1}`}
              />
              {selectMode && isSelected(index) && (
                <span className="select-badge">삭제 예정</span>
              )}
            </div>
          ) : (
            <p className="muted">표시할 페이지가 없습니다.</p>
          )}
          <button
            className="nav next"
            onClick={() => navIfNotSwiped(dir === 'rtl' ? -1 : 1)}
            onDoubleClick={(e) => e.stopPropagation()}
            disabled={dir === 'rtl' ? index === 0 : index >= total - 1}
            aria-label="다음 페이지"
          />
        </div>
      ) : view === 'scroll-v' ? (
        <div
          ref={scrollVRef}
          className="viewer-scroll-v"
          onClick={(e) => e.stopPropagation()}
        >
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              className={`viewer-frame ${selectMode ? 'selectable' : ''} ${
                isSelected(i) ? 'selected' : ''
              }`}
              onClick={selectMode ? () => toggle(i) : onCenterClick}
            >
              <img
                className="viewer-img"
                src={pageUrl(archive.id, i)}
                alt={`page ${i + 1}`}
                loading="lazy"
              />
              {selectMode && isSelected(i) && (
                <span className="select-badge">삭제 예정</span>
              )}
              {selectMode && <span className="select-index">{i + 1}</span>}
            </div>
          ))}
        </div>
      ) : (
        // 가로 연속 모드: 좌/우 nav 영역 없음 — 자연 스크롤(스와이프 / 휠) 로만 이동
        <div
          ref={scrollHRef}
          className="viewer-scroll-h"
          dir={dir}
          onClick={(e) => e.stopPropagation()}
        >
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              className={`viewer-frame ${selectMode ? 'selectable' : ''} ${
                isSelected(i) ? 'selected' : ''
              }`}
              onClick={selectMode ? () => toggle(i) : onCenterClick}
            >
              <img
                className="viewer-img"
                src={pageUrl(archive.id, i)}
                alt={`page ${i + 1}`}
                loading="lazy"
              />
              {selectMode && isSelected(i) && (
                <span className="select-badge">삭제 예정</span>
              )}
              {selectMode && <span className="select-index">{i + 1}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 하단 썸네일 네비게이션 — 페이지 직접 이동. 상단바와 동기 자동 숨김. */}
      {total > 1 && (
        <nav
          className={`viewer-thumbs ${barVisible || selectMode || repackPending ? '' : 'hidden'}`}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="thumbs-inner" ref={thumbsRef} dir={dir}>
            {Array.from({ length: total }, (_, i) => (
              <button
                key={i}
                className={`thumb ${i === index ? 'on' : ''}`}
                onClick={() => navTo(i)}
                title={`페이지 ${i + 1}`}
                aria-label={`페이지 ${i + 1}로 이동`}
              >
                <img
                  src={pageUrl(archive.id, i, 'thumb')}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
                <span className="thumb-num">{i + 1}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
