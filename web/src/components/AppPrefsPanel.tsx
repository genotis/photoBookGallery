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

      <p className="muted small">
        뷰어가 현재 페이지 <strong>앞뒤로</strong> 미리 로드(리사이즈 포함)할 페이지
        수입니다. 창은 페이지를 넘기면 따라 이동하며 계속 이어서 처리하고, 이미
        처리한 페이지는 유지합니다. 크게 잡을수록 넘김이 매끄럽지만 서버 부담이
        커집니다.
      </p>

      <div className="behavior-field">
        <label className="behavior-label" htmlFor="viewer-prefetch">
          뷰어 로드 갯수 (앞뒤 각각) — <strong>{p.viewerPrefetch}개</strong>
        </label>
        <input
          id="viewer-prefetch"
          type="range"
          min={10}
          max={200}
          step={10}
          value={p.viewerPrefetch}
          onChange={(e) => update({ viewerPrefetch: Number(e.target.value) })}
          aria-label="뷰어 로드 갯수"
        />
        <span className="muted small">10 ~ 200 범위. 작을수록 서버 부담이 적습니다.</span>
      </div>
    </section>
  );
}
