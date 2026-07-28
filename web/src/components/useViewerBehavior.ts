import { useEffect, useState } from 'react';

export type RevealMode = 'motion' | 'dblclick' | 'both';

export interface ViewerBehavior {
  /** UI(상단바·썸네일 네비) 가 다시 나타나는 트리거 */
  reveal: RevealMode;
  /** 단일 보기 모드에서 좌/우 1/3 영역 탭으로 페이지 넘김 활성 */
  tapNav: boolean;
  /** 슬라이드쇼 자동 진행 간격 (초). 1~60 범위. */
  slideshowSec: number;
  /** 슬라이드쇼가 마지막 페이지에 닿으면 다음 사진집으로 자동 이어가기 */
  slideshowNextFile: boolean;
  /**
   * 하단 썸네일 네비(목차) 표시. 끄면 네비 자체를 렌더하지 않아 썸네일 <img> 가
   * 생성되지 않는다 → 목차용 썸네일 리사이즈 요청이 아예 발생하지 않음(단순 숨김
   * 아님). 목차가 페이지보다 늦게 뜨는 게 싫은 경우 완전히 끌 수 있다.
   */
  thumbnailStrip: boolean;
}

const STORAGE_KEY = 'pbg.viewerBehavior.v1';

const DEFAULT: ViewerBehavior = {
  reveal: 'both',
  tapNav: true,
  slideshowSec: 5,
  slideshowNextFile: false,
  thumbnailStrip: true,
};

function load(): ViewerBehavior {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<ViewerBehavior>;
    return {
      reveal:
        v.reveal === 'motion' || v.reveal === 'dblclick' || v.reveal === 'both'
          ? v.reveal
          : DEFAULT.reveal,
      tapNav: typeof v.tapNav === 'boolean' ? v.tapNav : DEFAULT.tapNav,
      slideshowSec:
        typeof v.slideshowSec === 'number' && v.slideshowSec >= 1 && v.slideshowSec <= 60
          ? Math.round(v.slideshowSec)
          : DEFAULT.slideshowSec,
      slideshowNextFile:
        typeof v.slideshowNextFile === 'boolean'
          ? v.slideshowNextFile
          : DEFAULT.slideshowNextFile,
      thumbnailStrip:
        typeof v.thumbnailStrip === 'boolean'
          ? v.thumbnailStrip
          : DEFAULT.thumbnailStrip,
    };
  } catch {
    return DEFAULT;
  }
}

// 모듈 레벨 단일 진실 원천 — 한 앱 내 여러 컴포넌트가 같은 값을 보고 즉시 동기화.
let state: ViewerBehavior = load();
const listeners = new Set<(b: ViewerBehavior) => void>();

function persist(next: ViewerBehavior): void {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 무시
  }
  listeners.forEach((fn) => fn(next));
}

export function useViewerBehavior(): readonly [
  ViewerBehavior,
  (patch: Partial<ViewerBehavior>) => void,
] {
  const [b, setB] = useState<ViewerBehavior>(state);
  useEffect(() => {
    listeners.add(setB);
    return () => {
      listeners.delete(setB);
    };
  }, []);
  const update = (patch: Partial<ViewerBehavior>): void => {
    persist({ ...state, ...patch });
  };
  return [b, update] as const;
}
