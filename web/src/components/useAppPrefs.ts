import { useEffect, useState } from 'react';

/**
 * 앱 전역(뷰어 외) 환경설정. localStorage 영속 + 모듈 레벨 단일 진실 원천.
 * `useViewerBehavior` 와 같은 패턴 — 여러 컴포넌트가 즉시 동기화된다.
 */
export interface AppPrefs {
  /** 사이드바의 "랜덤" 메뉴가 한 번에 가져올 아카이브 수. */
  randomCount: number;
}

const STORAGE_KEY = 'pbg.appPrefs.v1';

const DEFAULT: AppPrefs = {
  randomCount: 20,
};

function load(): AppPrefs {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<AppPrefs>;
    return {
      randomCount:
        typeof v.randomCount === 'number' &&
        v.randomCount >= 5 &&
        v.randomCount <= 200
          ? Math.round(v.randomCount)
          : DEFAULT.randomCount,
    };
  } catch {
    return DEFAULT;
  }
}

let state: AppPrefs = load();
const listeners = new Set<(p: AppPrefs) => void>();

function persist(next: AppPrefs): void {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn(next));
}

export function useAppPrefs(): readonly [AppPrefs, (patch: Partial<AppPrefs>) => void] {
  const [p, setP] = useState<AppPrefs>(state);
  useEffect(() => {
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  const update = (patch: Partial<AppPrefs>): void => {
    persist({ ...state, ...patch });
  };
  return [p, update] as const;
}
