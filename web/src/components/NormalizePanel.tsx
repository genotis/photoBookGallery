import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function NormalizePanel() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['normalize-status'],
    queryFn: () => api.normalizeStatus(),
    refetchInterval: (q) => {
      const s = q.state.data;
      const st = s?.job?.status;
      return st === 'running' || st === 'pending' ? 1500 : false;
    },
  });

  const start = useMutation({
    mutationFn: () => api.normalizeStart(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['normalize-status'] }),
  });
  const cancel = useMutation({
    mutationFn: () => api.normalizeCancel(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['normalize-status'] }),
  });

  const s = status.data;
  const st = s?.job?.status;
  const running = st === 'running' || st === 'pending';

  // 배치가 끝나면(파일 재작성 → contentHash 변경) 그리드/패싯을 새로고침.
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !running) {
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    }
    prevRunning.current = running;
  }, [running, qc]);

  const pct = Math.round((s?.job?.progress ?? 0) * 100);
  const live = s?.live;

  return (
    <section className="settings-section">
      <h4>무압축(Store) 정규화</h4>
      <p className="muted small">
        압축(Deflate)이 걸린 사진집을 <strong>무압축(Store) .cbz</strong> 로 다시
        씁니다. 이미지 아카이브는 압축률이 0에 가까워 압축이 사실상 CPU 낭비이며,
        무압축이면 오프셋 직독이 순수 바이트 읽기가 되어 로딩이 빨라집니다. 원본은
        백업 경로로 보관되고, 파일이 재작성되므로 시간이 걸립니다(한 번에 하나씩,
        재시작·취소 가능). RAR/CBR 은 대상이 아닙니다.
      </p>

      <div className="auto-tag-actions">
        {!running ? (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `압축된 사진집 ${s?.remaining ?? '?'}개를 무압축으로 재작성합니다.\n` +
                    '원본은 백업되고 파일이 교체됩니다. 계속할까요?',
                )
              )
                start.mutate();
            }}
            disabled={start.isPending || (s ? s.remaining === 0 : true)}
          >
            {s && s.remaining === 0
              ? '정규화할 항목 없음'
              : `정규화 시작 (${s?.remaining ?? '…'}개)`}
          </button>
        ) : (
          <button
            type="button"
            className="vb-danger"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
          >
            취소
          </button>
        )}
        {s && (
          <span className="muted small">남은 압축 항목: {s.remaining}개</span>
        )}
      </div>

      {running && (
        <div className="dup-summary">
          <p className="small">
            진행 {pct}%
            {live &&
              ` · ${live.done}/${live.total} 처리 · 변환 ${live.converted} · 실패 ${live.failed}`}
          </p>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: '#2a2e35',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: '#3b82f6',
                transition: 'width 300ms ease',
              }}
            />
          </div>
        </div>
      )}

      {st === 'done' && live && (
        <p className="muted small">
          완료: {live.converted}개 변환, {live.failed}개 실패.
        </p>
      )}
      {start.isError && (
        <p className="error small">{(start.error as Error).message}</p>
      )}
    </section>
  );
}
