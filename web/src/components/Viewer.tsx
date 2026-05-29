import { useCallback, useEffect, useState } from 'react';
import { ArchiveListItem, pageUrl } from '../api';

type Mode = 'single' | 'scroll';

export function Viewer({
  archive,
  onClose,
}: {
  archive: ArchiveListItem;
  onClose: () => void;
}) {
  const total = archive.pageCount;
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('single');

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));
    },
    [total],
  );

  // 키보드 네비게이션
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (mode === 'single' && (e.key === 'ArrowRight' || e.key === ' '))
        go(1);
      else if (mode === 'single' && e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, mode, onClose]);

  // 다음/이전 페이지 프리로딩 (단일 모드)
  useEffect(() => {
    if (mode !== 'single') return;
    [index + 1, index + 2, index - 1].forEach((i) => {
      if (i >= 0 && i < total) {
        const img = new Image();
        img.src = pageUrl(archive.id, i);
      }
    });
  }, [archive.id, index, mode, total]);

  return (
    <div className="viewer" onClick={onClose}>
      <header className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer-title">{archive.fileName}</span>
        <div className="viewer-tools">
          <button onClick={() => setMode(mode === 'single' ? 'scroll' : 'single')}>
            {mode === 'single' ? '연속 보기' : '단일 보기'}
          </button>
          {mode === 'single' && (
            <span className="viewer-page">
              {index + 1} / {total}
            </span>
          )}
          <button onClick={onClose}>닫기 ✕</button>
        </div>
      </header>

      {mode === 'single' ? (
        <div className="viewer-single" onClick={(e) => e.stopPropagation()}>
          <button className="nav prev" onClick={() => go(-1)} disabled={index === 0}>
            ‹
          </button>
          {total > 0 ? (
            <img
              key={index}
              className="viewer-img"
              src={pageUrl(archive.id, index)}
              alt={`page ${index + 1}`}
            />
          ) : (
            <p className="muted">표시할 페이지가 없습니다.</p>
          )}
          <button
            className="nav next"
            onClick={() => go(1)}
            disabled={index >= total - 1}
          >
            ›
          </button>
        </div>
      ) : (
        <div className="viewer-scroll" onClick={(e) => e.stopPropagation()}>
          {Array.from({ length: total }, (_, i) => (
            <img
              key={i}
              className="viewer-img"
              src={pageUrl(archive.id, i)}
              alt={`page ${i + 1}`}
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  );
}
