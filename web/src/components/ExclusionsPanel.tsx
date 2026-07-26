import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, RenderExclusion } from '../api';

/** 규칙 한 줄 — 활성 토글 / 패턴·타입·메모 인라인 수정 / 삭제. */
function ExclusionRow({ rule }: { rule: RenderExclusion }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [matchType, setMatchType] = useState<'glob' | 'regex'>(rule.matchType);
  const [pattern, setPattern] = useState(rule.pattern);
  const [note, setNote] = useState(rule.note ?? '');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['exclusions'] });
    // 표시 페이지 목록이 바뀌므로 열려 있는 뷰어 entries 도 무효화
    qc.invalidateQueries({ queryKey: ['entries'] });
  };

  const patch = useMutation({
    mutationFn: (data: Partial<RenderExclusion>) =>
      api.patchExclusion(rule.id, data),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeExclusion(rule.id),
    onSuccess: invalidate,
  });

  if (editing) {
    return (
      <li className="excl-row editing">
        <div className="excl-edit">
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as 'glob' | 'regex')}
          >
            <option value="glob">glob</option>
            <option value="regex">정규식</option>
          </select>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={matchType === 'glob' ? 'ad_*.jpg' : 'ad_\\d+\\.jpg'}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="메모 (선택)"
          />
        </div>
        <div className="excl-actions">
          <button
            type="button"
            onClick={() =>
              patch.mutate({ matchType, pattern, note: note || null })
            }
            disabled={!pattern.trim() || patch.isPending}
          >
            저장
          </button>
          <button type="button" className="ghost" onClick={() => setEditing(false)}>
            취소
          </button>
        </div>
        {patch.isError && (
          <p className="error small">{(patch.error as Error).message}</p>
        )}
      </li>
    );
  }

  return (
    <li className={`excl-row ${rule.enabled ? '' : 'off'}`}>
      <label className="excl-toggle" title={rule.enabled ? '사용 중' : '비활성'}>
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => patch.mutate({ enabled: e.target.checked })}
        />
      </label>
      <span className="excl-type">{rule.matchType === 'regex' ? '정규식' : 'glob'}</span>
      <code className="excl-pattern" title={rule.pattern}>
        {rule.pattern}
      </code>
      {rule.note && <span className="excl-note muted small">{rule.note}</span>}
      <div className="excl-actions">
        <button type="button" className="ghost" onClick={() => setEditing(true)}>
          수정
        </button>
        <button
          type="button"
          className="ghost danger"
          onClick={() => {
            if (window.confirm(`제외 규칙 "${rule.pattern}" 을 삭제할까요?`))
              remove.mutate();
          }}
          disabled={remove.isPending}
        >
          삭제
        </button>
      </div>
    </li>
  );
}

/** 새 규칙 추가 폼. */
function AddExclusion() {
  const qc = useQueryClient();
  const [matchType, setMatchType] = useState<'glob' | 'regex'>('glob');
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.createExclusion({ matchType, pattern, note: note || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exclusions'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
      setPattern('');
      setNote('');
    },
  });

  return (
    <div className="excl-add">
      <div className="excl-edit">
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as 'glob' | 'regex')}
        >
          <option value="glob">glob</option>
          <option value="regex">정규식</option>
        </select>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={matchType === 'glob' ? '예: ad_*.jpg, *광고*' : '예: ^ad_\\d+'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pattern.trim()) create.mutate();
          }}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모 (선택)"
        />
      </div>
      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={!pattern.trim() || create.isPending}
      >
        추가
      </button>
      {create.isError && (
        <p className="error small">{(create.error as Error).message}</p>
      )}
    </div>
  );
}

export function ExclusionsPanel() {
  const rules = useQuery({
    queryKey: ['exclusions'],
    queryFn: () => api.exclusions(),
  });

  return (
    <section className="settings-section">
      <h4>렌더 제외 (광고 등 미표시)</h4>
      <p className="muted small">
        압축 파일 내부 이미지 중 <strong>파일명</strong>이 패턴에 매칭되는 것을
        뷰어·표지·페이지에서 숨깁니다. 여러 책에 반복 등장하는 광고 이미지를 전역으로
        가릴 때 씁니다. 원본 파일은 삭제되지 않고 표시만 제외되며, 패턴 변경은 즉시
        반영됩니다. glob 은 <code>*</code>(임의)·<code>?</code>(한 글자), 정규식은 부분
        매칭을 지원합니다.
      </p>

      <AddExclusion />

      {rules.isLoading && <p className="muted small">불러오는 중…</p>}
      {rules.data && rules.data.length === 0 && (
        <p className="muted small">등록된 제외 규칙이 없습니다.</p>
      )}
      {rules.data && rules.data.length > 0 && (
        <ul className="excl-list">
          {rules.data.map((r) => (
            <ExclusionRow key={r.id} rule={r} />
          ))}
        </ul>
      )}
    </section>
  );
}
