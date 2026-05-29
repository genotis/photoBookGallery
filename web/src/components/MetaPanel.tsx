import { useEffect, useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  api,
  CountryRef,
  ModelRef,
  PublisherRef,
  SeriesRef,
  TagRef,
} from '../api';

interface NamedRef {
  id: number;
  name: string;
}

/** 다중 선택 + 새 항목 생성 가능한 토큰 입력. */
function TokenMultiSelect({
  label,
  options,
  value,
  onChange,
  onCreate,
}: {
  label: string;
  options: NamedRef[];
  value: NamedRef[];
  onChange: (next: NamedRef[]) => void;
  onCreate?: (name: string) => Promise<NamedRef>;
}) {
  const [input, setInput] = useState('');
  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const suggestions = options
    .filter(
      (o) =>
        !selectedIds.has(o.id) &&
        (input.trim() === '' ||
          o.name.toLowerCase().includes(input.toLowerCase())),
    )
    .slice(0, 8);
  const exact = options.find(
    (o) => o.name.toLowerCase() === input.trim().toLowerCase(),
  );

  const add = (item: NamedRef) => {
    if (selectedIds.has(item.id)) return;
    onChange([...value, item]);
    setInput('');
  };

  const submit = async () => {
    const name = input.trim();
    if (!name) return;
    if (exact) {
      add(exact);
      return;
    }
    if (onCreate) {
      const created = await onCreate(name);
      onChange([...value.filter((v) => v.id !== created.id), created]);
      setInput('');
    }
  };

  return (
    <div className="meta-field">
      <label>{label}</label>
      <div className="token-row">
        {value.map((v) => (
          <span key={v.id} className="token">
            {v.name}
            <button
              type="button"
              className="token-remove"
              onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              aria-label={`${v.name} 제거`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          className="token-input"
          value={input}
          placeholder={onCreate ? '검색 또는 새로 추가' : '검색'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Backspace' && !input && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {(suggestions.length > 0 || (onCreate && input.trim() && !exact)) && (
        <ul className="suggest">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => add(s)}>
                {s.name}
              </button>
            </li>
          ))}
          {onCreate && input.trim() && !exact && (
            <li>
              <button type="button" onClick={submit} className="suggest-create">
                + 새로 만들기: &quot;{input.trim()}&quot;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** 단일 선택 + 새 항목 생성 가능. */
function SingleSelect<T extends NamedRef>({
  label,
  options,
  value,
  onChange,
  onCreate,
}: {
  label: string;
  options: T[];
  value: T | null;
  onChange: (next: T | null) => void;
  onCreate?: (name: string) => Promise<T>;
}) {
  const [input, setInput] = useState('');
  const suggestions = options
    .filter(
      (o) =>
        input.trim() === '' || o.name.toLowerCase().includes(input.toLowerCase()),
    )
    .slice(0, 8);
  const exact = options.find(
    (o) => o.name.toLowerCase() === input.trim().toLowerCase(),
  );

  return (
    <div className="meta-field">
      <label>{label}</label>
      {value ? (
        <div className="token-row">
          <span className="token">
            {value.name}
            <button
              type="button"
              className="token-remove"
              onClick={() => onChange(null)}
              aria-label="해제"
            >
              ✕
            </button>
          </span>
        </div>
      ) : (
        <>
          <input
            value={input}
            placeholder={onCreate ? '검색 또는 새로 추가' : '검색'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const name = input.trim();
              if (!name) return;
              if (exact) {
                onChange(exact);
                setInput('');
              } else if (onCreate) {
                const created = await onCreate(name);
                onChange(created);
                setInput('');
              }
            }}
          />
          {(suggestions.length > 0 || (onCreate && input.trim() && !exact)) && (
            <ul className="suggest">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(s);
                      setInput('');
                    }}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
              {onCreate && input.trim() && !exact && (
                <li>
                  <button
                    type="button"
                    className="suggest-create"
                    onClick={async () => {
                      const created = await onCreate(input.trim());
                      onChange(created);
                      setInput('');
                    }}
                  >
                    + 새로 만들기: &quot;{input.trim()}&quot;
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function MetaPanel({
  archiveId,
  onClose,
}: {
  archiveId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['archive', archiveId],
    queryFn: () => api.archiveDetail(archiveId),
  });

  const models = useQuery({ queryKey: ['models'], queryFn: () => api.models() });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.tags() });
  const publishers = useQuery({
    queryKey: ['publishers'],
    queryFn: () => api.publishers(),
  });
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: () => api.countries(),
  });
  const seriesList = useQuery({
    queryKey: ['series'],
    queryFn: () => api.series(),
  });

  const [form, setForm] = useState<{
    title: string;
    favorite: boolean;
    rating: number | null;
    note: string;
    country: CountryRef | null;
    publisher: PublisherRef | null;
    series: SeriesRef | null;
    selectedModels: NamedRef[];
    selectedTags: NamedRef[];
  } | null>(null);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setForm({
      title: d.title ?? '',
      favorite: d.favorite,
      rating: d.rating,
      note: d.note ?? '',
      country: d.country,
      publisher: d.publisher,
      series: d.series,
      selectedModels: d.models.map((m) => m.model),
      selectedTags: d.tags.map((t) => t.tag),
    });
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error('not ready');
      return api.patchArchive(archiveId, {
        title: form.title.trim() || null,
        favorite: form.favorite,
        rating: form.rating,
        note: form.note || null,
        countryId: form.country?.id ?? null,
        publisherId: form.publisher?.id ?? null,
        seriesId: form.series?.id ?? null,
        modelIds: form.selectedModels.map((m) => m.id),
        tagIds: form.selectedTags.map((t) => t.id),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['archive', archiveId] });
      qc.invalidateQueries({ queryKey: ['facets'] });
      onClose();
    },
  });

  const createModel = async (name: string): Promise<ModelRef> => {
    const m = await api.createModel(name);
    qc.invalidateQueries({ queryKey: ['models'] });
    return m;
  };
  const createTag = async (name: string): Promise<TagRef> => {
    const t = await api.createTag(name);
    qc.invalidateQueries({ queryKey: ['tags'] });
    return t;
  };
  const createPublisher = async (name: string): Promise<PublisherRef> => {
    const p = await api.createPublisher(name);
    qc.invalidateQueries({ queryKey: ['publishers'] });
    return p;
  };
  const createSeries = async (name: string): Promise<SeriesRef> => {
    const s = await api.createSeries(name);
    qc.invalidateQueries({ queryKey: ['series'] });
    return s;
  };

  // ---- 파일명 추정 ----
  const [suggestion, setSuggestion] = useState<{
    country: { code: string; name?: string; existingId?: number } | null;
    publisher: { name: string; existingId?: number } | null;
    models: { name: string; aliases?: string[]; existingId?: number }[];
    title: string | null;
  } | null>(null);
  const [suggestStatus, setSuggestStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const fetchSuggestion = async () => {
    setSuggestStatus('loading');
    setSuggestError(null);
    try {
      const s = await api.suggestions(archiveId);
      setSuggestion(s);
      setSuggestStatus('idle');
    } catch (e) {
      setSuggestStatus('error');
      setSuggestError(e instanceof Error ? e.message : '추정 실패');
    }
  };

  const applySuggestion = async () => {
    if (!suggestion || !form) return;
    const nextForm = { ...form };

    if (suggestion.title && !nextForm.title.trim()) {
      nextForm.title = suggestion.title;
    }

    if (suggestion.country && !nextForm.country) {
      const sc = suggestion.country;
      if (sc.existingId && countries.data) {
        const existing = countries.data.find((c) => c.id === sc.existingId);
        if (existing) nextForm.country = existing;
      } else {
        const created = await api.createCountry(sc.code, sc.name ?? sc.code);
        qc.invalidateQueries({ queryKey: ['countries'] });
        nextForm.country = created;
      }
    }

    if (suggestion.publisher && !nextForm.publisher) {
      const s = suggestion.publisher;
      if (s.existingId && publishers.data) {
        const existing = publishers.data.find((p) => p.id === s.existingId);
        if (existing) nextForm.publisher = existing;
      } else {
        const created = await createPublisher(s.name);
        nextForm.publisher = created;
      }
    }

    const existingIds = new Set(nextForm.selectedModels.map((m) => m.id));
    const lowerNames = new Set(
      nextForm.selectedModels.map((m) => m.name.toLowerCase()),
    );
    for (const sm of suggestion.models) {
      if (sm.existingId) {
        if (!existingIds.has(sm.existingId) && models.data) {
          const ref = models.data.find((m) => m.id === sm.existingId);
          if (ref) {
            nextForm.selectedModels = [...nextForm.selectedModels, ref];
            existingIds.add(ref.id);
            lowerNames.add(ref.name.toLowerCase());
          }
        }
      } else if (!lowerNames.has(sm.name.toLowerCase())) {
        const created = await api.createModel(sm.name, sm.aliases);
        qc.invalidateQueries({ queryKey: ['models'] });
        nextForm.selectedModels = [...nextForm.selectedModels, created];
        existingIds.add(created.id);
        lowerNames.add(created.name.toLowerCase());
      }
    }

    setForm(nextForm);
    setSuggestion(null);
  };

  return (
    <div className="meta-overlay" onClick={onClose}>
      <aside className="meta-panel" onClick={(e) => e.stopPropagation()}>
        <header className="meta-bar">
          <h3>메타데이터</h3>
          <button className="ghost" onClick={onClose}>
            닫기 ✕
          </button>
        </header>

        {!form ? (
          <p className="muted">로딩 중…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="meta-filename">{detail.data?.fileName}</p>

            <div className="meta-field">
              <label>제목</label>
              <input
                value={form.title}
                placeholder="사진집 제목 (없으면 파일명이 표시됩니다)"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className="meta-suggest">
              <button
                type="button"
                className="ghost"
                onClick={fetchSuggestion}
                disabled={suggestStatus === 'loading'}
              >
                🪄 {suggestStatus === 'loading' ? '추정 중…' : '파일명에서 추정'}
              </button>
              {suggestError && (
                <span className="error small">{suggestError}</span>
              )}
            </div>

            {suggestion && (
              <div className="suggest-banner">
                <div className="suggest-chips">
                  {suggestion.title && (
                    <span
                      className="suggest-chip new"
                      title="새 제목"
                    >
                      제목: {suggestion.title}
                    </span>
                  )}
                  {suggestion.country && (
                    <span
                      className={`suggest-chip ${
                        suggestion.country.existingId ? 'exists' : 'new'
                      }`}
                      title={
                        suggestion.country.existingId
                          ? '기존 국가'
                          : '새로 생성됩니다'
                      }
                    >
                      국가: {suggestion.country.code}
                      {suggestion.country.name
                        ? ` (${suggestion.country.name})`
                        : ''}
                    </span>
                  )}
                  {suggestion.publisher && (
                    <span
                      className={`suggest-chip ${
                        suggestion.publisher.existingId ? 'exists' : 'new'
                      }`}
                      title={
                        suggestion.publisher.existingId
                          ? '기존 출판사'
                          : '새로 생성됩니다'
                      }
                    >
                      출판사: {suggestion.publisher.name}
                    </span>
                  )}
                  {suggestion.models.map((m, i) => (
                    <span
                      key={`${m.name}-${i}`}
                      className={`suggest-chip ${
                        m.existingId ? 'exists' : 'new'
                      }`}
                      title={m.existingId ? '기존 모델' : '새로 생성됩니다'}
                    >
                      모델: {m.name}
                      {m.aliases && m.aliases.length > 0 && (
                        <span className="suggest-alias"> ({m.aliases.join(', ')})</span>
                      )}
                    </span>
                  ))}
                  {!suggestion.country &&
                    !suggestion.publisher &&
                    suggestion.models.length === 0 && (
                      <span className="muted small">
                        추정 가능한 항목이 없습니다.
                      </span>
                    )}
                </div>
                {(suggestion.country ||
                  suggestion.publisher ||
                  suggestion.models.length > 0) && (
                  <div className="suggest-actions">
                    <button
                      type="button"
                      onClick={() => {
                        void applySuggestion();
                      }}
                    >
                      적용
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setSuggestion(null)}
                    >
                      취소
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="meta-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.favorite}
                  onChange={(e) =>
                    setForm({ ...form, favorite: e.target.checked })
                  }
                />
                즐겨찾기
              </label>

              <div className="meta-rating">
                평점:
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`star ${form.rating && form.rating >= n ? 'on' : ''}`}
                    onClick={() =>
                      setForm({
                        ...form,
                        rating: form.rating === n ? null : n,
                      })
                    }
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <SingleSelect
              label="국가"
              options={countries.data ?? []}
              value={form.country}
              onChange={(c) => setForm({ ...form, country: c })}
            />
            <SingleSelect
              label="출판사 / 제작주체"
              options={publishers.data ?? []}
              value={form.publisher}
              onChange={(p) => setForm({ ...form, publisher: p })}
              onCreate={createPublisher}
            />
            <SingleSelect
              label="시리즈"
              options={seriesList.data ?? []}
              value={form.series}
              onChange={(s) => setForm({ ...form, series: s })}
              onCreate={createSeries}
            />
            <TokenMultiSelect
              label="모델"
              options={models.data ?? []}
              value={form.selectedModels}
              onChange={(v) => setForm({ ...form, selectedModels: v })}
              onCreate={createModel}
            />
            <TokenMultiSelect
              label="태그"
              options={tags.data ?? []}
              value={form.selectedTags}
              onChange={(v) => setForm({ ...form, selectedTags: v })}
              onCreate={createTag}
            />

            <div className="meta-field">
              <label>메모</label>
              <textarea
                rows={4}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>

            {save.isError && (
              <p className="error">{(save.error as Error).message}</p>
            )}

            <div className="meta-actions">
              <button className="ghost" type="button" onClick={onClose}>
                취소
              </button>
              <button type="submit" disabled={save.isPending}>
                {save.isPending ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
