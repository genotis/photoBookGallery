import { RevealMode, useViewerBehavior } from './useViewerBehavior';

const REVEAL_OPTIONS: { value: RevealMode; label: string; hint: string }[] = [
  { value: 'motion', label: '마우스 움직임', hint: '마우스/터치 모션 시 UI 표시' },
  { value: 'dblclick', label: '중앙 더블클릭', hint: '중앙 영역 더블클릭으로만 토글' },
  { value: 'both', label: '둘 다', hint: '모션 자동 표시 + 더블클릭 토글' },
];

export function ViewerBehaviorPanel() {
  const [b, update] = useViewerBehavior();

  return (
    <section className="settings-section">
      <h4>뷰어 동작</h4>
      <p className="muted small">
        뷰어 화면에서 상단바와 하단 썸네일 네비를 어떻게 표시할지 선택합니다.
      </p>

      <div className="behavior-field">
        <span className="behavior-label">UI 표시 방법</span>
        <div className="vb-seg vb-seg-wide" role="group" aria-label="UI 표시 방법">
          {REVEAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`vb-seg-item vb-seg-text ${b.reveal === opt.value ? 'on' : ''}`}
              onClick={() => update({ reveal: opt.value })}
              title={opt.hint}
              aria-pressed={b.reveal === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="check small behavior-field">
        <input
          type="checkbox"
          checked={b.tapNav}
          onChange={(e) => update({ tapNav: e.target.checked })}
        />
        좌/우 탭으로 페이지 넘김 (단일 보기에서 화면 좌·우 1/3 영역을 탭하면 이전/다음 페이지로 이동)
      </label>

      <div className="behavior-status">
        현재 적용된 값:{' '}
        <code>
          tapNav={String(b.tapNav)}, reveal={b.reveal}
        </code>
        <button
          type="button"
          className="ghost"
          onClick={() => update({ reveal: 'both', tapNav: true })}
          title="기본값으로 되돌림"
        >
          기본값
        </button>
      </div>
    </section>
  );
}
