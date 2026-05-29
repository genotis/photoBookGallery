import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useJobStream } from './useJobStream';

interface PreviewItem {
  archiveId: number;
  fileName: string;
  current: {
    title: string | null;
    country: { id: number; code: string } | null;
    publisher: { id: number; name: string } | null;
    models: { id: number; name: string }[];
  };
  suggestion: {
    title: string | null;
    country: { code: string; existingId?: number } | null;
    publisher: { name: string; existingId?: number } | null;
    models: { name: string; aliases?: string[]; existingId?: number }[];
  };
  willChange: boolean;
}

export function AutoTagPanel() {
  const qc = useQueryClient();
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [preview, setPreview] = useState<{
    total: number;
    sampled: number;
    items: PreviewItem[];
  } | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useJobStream(jobId);

  const previewMut = useMutation({
    mutationFn: () => api.autoTagPreview(onlyMissing, 20),
    onSuccess: (data) => setPreview(data),
  });

  const applyMut = useMutation({
    mutationFn: () => api.autoTagApply(onlyMissing),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
      qc.invalidateQueries({ queryKey: ['models'] });
      qc.invalidateQueries({ queryKey: ['publishers'] });
      qc.invalidateQueries({ queryKey: ['countries'] });
      setPreview(null);
    }
  }, [job?.status, qc]);

  const stats = parseStats(job?.payload);

  return (
    <section className="settings-section">
      <h4>자동 태깅</h4>
      <p className="muted small">
        파일명 휴리스틱으로 국가·출판사·모델을 일괄 추정해 채웁니다. 기존에 채워진
        필드는 보존되며 비어있는 칸만 채웁니다.
      </p>

      <label className="check small">
        <input
          type="checkbox"
          checked={onlyMissing}
          onChange={(e) => setOnlyMissing(e.target.checked)}
        />
        메타데이터가 비어있는 아카이브만
      </label>

      <div className="auto-tag-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => previewMut.mutate()}
          disabled={previewMut.isPending || applyMut.isPending}
        >
          {previewMut.isPending ? '집계 중…' : '미리보기'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                '추정된 메타데이터를 적용합니다.\n새 모델/출판사/국가가 자동 생성될 수 있습니다.',
              )
            ) {
              applyMut.mutate();
            }
          }}
          disabled={applyMut.isPending || jobActive(job?.status)}
        >
          전체 적용
        </button>
      </div>

      {previewMut.isError && (
        <p className="error small">{(previewMut.error as Error).message}</p>
      )}
      {applyMut.isError && (
        <p className="error small">{(applyMut.error as Error).message}</p>
      )}

      {preview && (
        <div className="auto-tag-preview">
          <p className="small">
            대상 <strong>{preview.total}</strong>건 — 변경 예정{' '}
            <strong>
              {preview.items.filter((i) => i.willChange).length}
            </strong>
            건 / 샘플 {preview.sampled}건
          </p>
          <ul className="auto-tag-list">
            {preview.items.slice(0, 10).map((it) => (
              <li
                key={it.archiveId}
                className={it.willChange ? 'will' : 'skip'}
              >
                <div className="auto-tag-name" title={it.fileName}>
                  {it.fileName}
                </div>
                <div className="auto-tag-chips">
                  {it.suggestion.title && !it.current.title && (
                    <span className="suggest-chip new" title="새 제목">
                      제목: {it.suggestion.title}
                    </span>
                  )}
                  {it.suggestion.country && !it.current.country && (
                    <span className="suggest-chip new">
                      국가: {it.suggestion.country.code}
                    </span>
                  )}
                  {it.suggestion.publisher && !it.current.publisher && (
                    <span
                      className={`suggest-chip ${
                        it.suggestion.publisher.existingId ? 'exists' : 'new'
                      }`}
                    >
                      출판사: {it.suggestion.publisher.name}
                    </span>
                  )}
                  {it.suggestion.models.map((m, i) => {
                    const has = it.current.models.some(
                      (cm) =>
                        m.existingId === cm.id ||
                        m.name.toLowerCase() === cm.name.toLowerCase(),
                    );
                    if (has) return null;
                    return (
                      <span
                        key={`${m.name}-${i}`}
                        className={`suggest-chip ${
                          m.existingId ? 'exists' : 'new'
                        }`}
                      >
                        모델: {m.name}
                        {m.aliases?.length ? (
                          <span className="suggest-alias">
                            {' '}
                            ({m.aliases.join(', ')})
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                  {!it.willChange && (
                    <span className="muted small">변경 없음</span>
                  )}
                </div>
              </li>
            ))}
            {preview.items.length > 10 && (
              <li className="muted small">
                … 외 {preview.items.length - 10}건 (샘플)
              </li>
            )}
            {preview.items.length === 0 && (
              <li className="muted small">대상 아카이브가 없습니다.</li>
            )}
          </ul>
        </div>
      )}

      {job && job.status !== 'done' && job.status !== 'failed' && (
        <div className="job">
          자동 태깅 중… {Math.round((job.progress ?? 0) * 100)}%
        </div>
      )}
      {job?.status === 'done' && stats && (
        <div className="job done">
          완료 — 아카이브 {stats.archives}건 변경, 신규 국가 {stats.newCountries}
          · 출판사 {stats.newPublishers} · 모델 {stats.newModels}
        </div>
      )}
      {job?.status === 'failed' && (
        <p className="error small">실패: {job.error}</p>
      )}
    </section>
  );
}

function jobActive(s: string | undefined): boolean {
  return s !== undefined && s !== 'done' && s !== 'failed';
}

function parseStats(payload: string | undefined | null): {
  archives: number;
  newCountries: number;
  newPublishers: number;
  newModels: number;
} | null {
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as {
      stats?: {
        archives?: number;
        newCountries?: number;
        newPublishers?: number;
        newModels?: number;
      };
    };
    if (!obj.stats) return null;
    return {
      archives: obj.stats.archives ?? 0,
      newCountries: obj.stats.newCountries ?? 0,
      newPublishers: obj.stats.newPublishers ?? 0,
      newModels: obj.stats.newModels ?? 0,
    };
  } catch {
    return null;
  }
}
