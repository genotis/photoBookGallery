import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, Job } from '../api';

export function RootsBar() {
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);

  const roots = useQuery({ queryKey: ['roots'], queryFn: api.roots });

  const add = useMutation({
    mutationFn: () => api.addRoot(path.trim()),
    onSuccess: () => {
      setPath('');
      qc.invalidateQueries({ queryKey: ['roots'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.removeRoot(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roots'] });
      qc.invalidateQueries({ queryKey: ['archives'] });
    },
  });

  const scan = useMutation({
    mutationFn: (id: number) => api.scanRoot(id),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  // 스캔 작업 진행상황 폴링
  const job = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId as number),
    enabled: jobId !== null,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'done' || s === 'failed' ? false : 1000;
    },
  });

  const jobStatus = job.data?.status;
  useEffect(() => {
    if (jobStatus === 'done' || jobStatus === 'failed') {
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['roots'] });
    }
  }, [jobStatus, qc]);

  return (
    <aside className="roots">
      <h3>라이브러리 루트</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) add.mutate();
        }}
      >
        <input
          placeholder="NAS 경로 (예: /media/photobooks)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button type="submit" disabled={add.isPending}>
          추가
        </button>
      </form>
      {add.isError && <p className="error">{(add.error as Error).message}</p>}

      <ul className="root-list">
        {roots.data?.map((r) => (
          <li key={r.id}>
            <div className="root-meta">
              <span className="root-path">{r.label ?? r.path}</span>
              <span className="root-count">{r._count.archives}권</span>
            </div>
            <div className="root-actions">
              <button onClick={() => scan.mutate(r.id)}>스캔</button>
              <button className="ghost" onClick={() => remove.mutate(r.id)}>
                제거
              </button>
            </div>
          </li>
        ))}
        {roots.data?.length === 0 && (
          <li className="muted">등록된 루트가 없습니다.</li>
        )}
      </ul>

      {job.data && job.data.status !== 'done' && (
        <div className="job">
          인덱싱 중… {Math.round((job.data.progress ?? 0) * 100)}%
        </div>
      )}
      {job.data?.status === 'failed' && (
        <p className="error">인덱싱 실패: {job.data.error}</p>
      )}
    </aside>
  );
}
