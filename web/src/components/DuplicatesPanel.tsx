import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useJobStream } from './useJobStream';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

export function DuplicatesPanel() {
  const qc = useQueryClient();
  const latest = useQuery({
    queryKey: ['duplicates-latest'],
    queryFn: () => api.duplicatesLatest(),
  });
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useJobStream(jobId);

  const scan = useMutation({
    mutationFn: () => api.duplicatesScan(),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      qc.invalidateQueries({ queryKey: ['duplicates-latest'] });
    }
  }, [job?.status, qc]);

  const inProgress = job && job.status !== 'done' && job.status !== 'failed';
  const data = latest.data;

  return (
    <section className="settings-section">
      <h4>중복 탐지</h4>
      <p className="muted small">
        등록된 라이브러리 루트 하위에서 동일 콘텐츠 해시(BLAKE3)를 가진 파일들을 찾아
        그룹화합니다. 단일 사진집이 여러 위치에 복제되었는지 확인하는 용도입니다.
      </p>

      <div className="auto-tag-actions">
        <button
          type="button"
          onClick={() => scan.mutate()}
          disabled={scan.isPending || Boolean(inProgress)}
        >
          {inProgress ? `스캔 중… ${Math.round((job?.progress ?? 0) * 100)}%` : '중복 스캔'}
        </button>
        {data && (
          <span className="muted small">
            마지막 스캔: {new Date(data.scannedAt).toLocaleString()}
          </span>
        )}
      </div>

      {scan.isError && (
        <p className="error small">{(scan.error as Error).message}</p>
      )}
      {job?.status === 'failed' && (
        <p className="error small">실패: {job.error}</p>
      )}

      {data && (
        <div className="dup-summary">
          <p className="small">
            스캔 파일 <strong>{data.totalFiles}</strong>건 · 신규 해시{' '}
            {data.hashedFiles} · 재사용 {data.reusedHashes} · 중복군{' '}
            <strong>{data.duplicateSets.length}</strong>건
          </p>
          {data.duplicateSets.length > 0 && (
            <ul className="dup-list">
              {data.duplicateSets.map((set) => (
                <li key={set.contentHash} className="dup-set">
                  <div className="dup-set-head">
                    <span className="dup-hash" title={set.contentHash}>
                      {set.contentHash.slice(0, 12)}…
                    </span>
                    <span className="muted small">
                      {set.paths.length}개 · {formatSize(set.size)}
                    </span>
                  </div>
                  <ul className="dup-paths">
                    {set.paths.map((p) => (
                      <li key={p.path} title={p.path}>
                        {p.path}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {data.duplicateSets.length === 0 && (
            <p className="muted small">중복 파일이 발견되지 않았습니다.</p>
          )}
        </div>
      )}
      {!data && !inProgress && (
        <p className="muted small">아직 스캔 결과가 없습니다.</p>
      )}
    </section>
  );
}
