import { useEffect, useState } from 'react';

export type RevealMode = 'motion' | 'dblclick' | 'both';

export interface ViewerBehavior {
  /** UI(상단바·썸네일 네비) 가 다시 나타나는 트리거 */
  reveal: RevealMode;
  /** 단일 보기 모드에서 좌/우 1/3 영역 탭으로 페이지 넘김 활성 */
  tapNav: boolean;
}

const STORAGE_KEY = 'pbg.viewerBehavior.v1';

const DEFAULT: ViewerBehavior = {
  reveal: 'both',
  tapNav: true,
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
