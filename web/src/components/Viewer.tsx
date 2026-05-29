import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ArchiveListItem, pageUrl } from '../api';
import { useJobStream } from './useJobStream';

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
}: {
  archive: ArchiveListItem;
  onClose: () => void;
  onEdit?: () => void;
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

  const [index, setIndex] = useState(0);

  // 선택 모드 (삭제 후 재압축)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + delta))),
    [total],
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
  }, [dir, go, index, view, onClose, selectMode, toggle]);

  // 프리로딩 (단일/가로 모드)
  useEffect(() => {
    if (view === 'scroll-v') return;
    [index + 1, index + 2, index - 1].forEach((i) => {
      if (i >= 0 && i < total) {
        const img = new Image();
        img.src = pageUrl(archive.id, i);
      }
    });
  }, [archive.id, index, view, total]);

  // 가로 스크롤: 현재 index 가 바뀌면 해당 페이지로 스크롤
  const scrollHRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (view !== 'scroll-h') return;
    const container = scrollHRef.current;
    if (!container) return;
    const child = container.children[index] as HTMLElement | undefined;
    child?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'smooth' });
  }, [index, view]);

  // 터치 스와이프 (단일 모드) — RTL 시 의미 반전
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (view !== 'single' || selectMode) return;
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    const fwd = dir === 'rtl' ? 1 : -1; // RTL: 오른쪽으로 스와이프하면 다음
    go(dx * fwd < 0 ? 1 : -1);
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
    const ok = window.confirm(
      `${selectedCount}개 페이지를 삭제하고 .cbz로 재압축합니다.\n` +
        '원본은 백업 경로로 보관됩니다. 계속할까요?',
    );
    if (ok) repack.mutate();
  };

  const isSelected = useMemo(() => (i: number) => selected.has(i), [selected]);
  const showDirToggle = view === 'single' || view === 'scroll-h';

  return (
    <div
      className={`viewer view-${view} fit-${fit} dir-${dir}`}
      onClick={onClose}
      onMouseMove={revealBar}
      onTouchStart={revealBar}
    >
      <header
        className={`viewer-bar ${barVisible || selectMode || repackPending ? '' : 'hidden'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vb-left">
          <button className="vb-icon vb-close" onClick={onClose} title="닫기 (Esc)">
            ✕
          </button>
          <span className="vb-title" title={archive.fileName}>
            {archive.title || archive.fileName}
          </span>
        </div>

        <div className="vb-center">
          {!selectMode && (view === 'single' || view === 'scroll-h') && (
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
          onTouchEnd={onTouchEnd}
        >
          <button
            className="nav prev"
            onClick={() => go(dir === 'rtl' ? 1 : -1)}
            disabled={dir === 'rtl' ? index >= total - 1 : index === 0}
            aria-label="이전 페이지"
          >
            ‹
          </button>
          {total > 0 ? (
            <div
              className={`viewer-frame ${selectMode ? 'selectable' : ''} ${
                isSelected(index) ? 'selected' : ''
              }`}
              onClick={selectMode ? () => toggle(index) : undefined}
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
            onClick={() => go(dir === 'rtl' ? -1 : 1)}
            disabled={dir === 'rtl' ? index === 0 : index >= total - 1}
            aria-label="다음 페이지"
          >
            ›
          </button>
        </div>
      ) : view === 'scroll-v' ? (
        <div className="viewer-scroll-v" onClick={(e) => e.stopPropagation()}>
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              className={`viewer-frame ${selectMode ? 'selectable' : ''} ${
                isSelected(i) ? 'selected' : ''
              }`}
              onClick={selectMode ? () => toggle(i) : undefined}
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
              onClick={selectMode ? () => toggle(i) : undefined}
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
    </div>
  );
}
