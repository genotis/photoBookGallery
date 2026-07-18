import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, coverUrl, ModelRef } from '../api';

/**
 * 모델별 브라우징 — 모델 카드 목록(대표 표지·권수·즐겨찾기).
 * 카드 클릭 시 onSelect 로 해당 모델의 사진집을 그리드에 필터링해 보여준다.
 * 즐겨찾기 모델이 상단에 정렬된다(서버 정렬).
 */
export function ModelGallery({
  onSelect,
}: {
  onSelect: (modelId: number, name: string) => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  const models = useQuery({
    queryKey: ['models', q],
    queryFn: () => api.models(q.trim() || undefined),
  });

  const fav = useMutation({
    mutationFn: ({ id, favorite }: { id: number; favorite: boolean }) =>
      api.patchModel(id, { favorite }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const items: ModelRef[] = (models.data ?? []).filter(
    (m) => !favOnly || m.favorite,
  );

  return (
    <section className="grid-wrap">
      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <input
            placeholder="모델 검색 (이름·별칭)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <label className="check small">
          <input
            type="checkbox"
            checked={favOnly}
            onChange={(e) => setFavOnly(e.target.checked)}
          />
          즐겨찾기만
        </label>
        <span className="count">{items.length}명</span>
      </div>

      {items.length === 0 && !models.isLoading ? (
        <p className="muted empty">
          {favOnly ? '즐겨찾기한 모델이 없습니다.' : '모델이 없습니다.'}
        </p>
      ) : (
        <div className="model-grid">
          {items.map((m) => (
            <div key={m.id} className="model-card">
              <button
                className="model-fav"
                title={m.favorite ? '즐겨찾기 해제' : '즐겨찾기'}
                aria-pressed={m.favorite}
                onClick={(e) => {
                  e.stopPropagation();
                  fav.mutate({ id: m.id, favorite: !m.favorite });
                }}
              >
                {m.favorite ? '★' : '☆'}
              </button>
              <button
                className="model-open"
                onClick={() => onSelect(m.id, m.name)}
                title={`${m.name} — ${m.count ?? 0}권`}
              >
                {m.profileImg ? (
                  <img src={m.profileImg} alt={m.name} loading="lazy" />
                ) : m.cover ? (
                  <img
                    src={coverUrl(m.cover.archiveId, m.cover.contentHash)}
                    alt={m.name}
                    loading="lazy"
                  />
                ) : (
                  <div className="no-cover">표지 없음</div>
                )}
                <div className="model-caption">
                  <span className="name">{m.name}</span>
                  <span className="pages">{m.count ?? 0}권</span>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}
      {models.isLoading && <p className="muted empty">불러오는 중…</p>}
    </section>
  );
}
