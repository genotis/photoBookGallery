import { useAppPrefs } from './useAppPrefs';

export function AppPrefsPanel() {
  const [p, update] = useAppPrefs();

  return (
    <section className="settings-section">
      <h4>탐색</h4>
      <p className="muted small">
        사이드바의 "랜덤" 메뉴가 한 번에 가져올 아카이브 수를 지정합니다.
      </p>

      <div className="behavior-field">
        <label className="behavior-label" htmlFor="random-count">
          랜덤 갯수 — <strong>{p.randomCount}개</strong>
        </label>
        <input
          id="random-count"
          type="range"
          min={5}
          max={100}
          step={5}
          value={p.randomCount}
          onChange={(e) => update({ randomCount: Number(e.target.value) })}
          aria-label="랜덤 갯수"
        />
        <span className="muted small">5 ~ 100 범위.</span>
      </div>
    </section>
  );
}
