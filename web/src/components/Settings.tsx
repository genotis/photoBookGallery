import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, Root } from '../api';
import { AutoTagPanel } from './AutoTagPanel';
import { DuplicatesPanel } from './DuplicatesPanel';
import { useJobStream } from './useJobStream';

function RootRow({ root }: { root: Root }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(root.label ?? '');
  const [scanCron, setScanCron] = useState(root.scanCron ?? '');
  const [jobId, setJobId] = useState<number | null>(null);

  // 외부 prop 이 바뀌면 편집중이 아닐 때 동기화
  useEffect(() => {
    if (!editing) {
      setLabel(root.label ?? '');
      setScanCron(root.scanCron ?? '');
    }
  }, [editing, root.label, root.scanCron]);

  const patch = useMutation({
    mutationFn: () =>
      api.patchRoot(root.id, {
        label: label.trim() || null,
        scanCron: scanCron.trim() || null,
      }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['roots'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeRoot(root.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roots'] });
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
    },
  });

  const scan = useMutation({
    mutationFn: () => api.scanRoot(root.id),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  const job = useJobStream(jobId);
  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      qc.invalidateQueries({ queryKey: ['archives'] });
      qc.invalidateQueries({ queryKey: ['roots'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
    }
  }, [job?.status, qc]);

  return (
    <li>
      <div className="root-meta">
        <span className="root-path">
          {root.label ? `${root.label} — ` : ''}
          {root.path}
        </span>
        <span className="root-count">{root._count.archives}권</span>
      </div>
      {!editing ? (
        <div className="root-extra">
          {root.scanCron ? (
            <span className="root-cron">⏱ {root.scanCron}</span>
          ) : (
            <span className="muted small">자동 스캔 없음</span>
          )}
        </div>
      ) : (
        <div className="root-edit">
          <label>
            라벨
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="라벨(선택)"
            />
          </label>
          <label>
            자동 스캔 cron
            <input
              value={scanCron}
              onChange={(e) => setScanCron(e.target.value)}
              placeholder='예: "0 3 * * *" (매일 03:00)'
            />
          </label>
          {patch.isError && (
            <p className="error small">{(patch.error as Error).message}</p>
          )}
        </div>
      )}
      <div className="root-actions">
        {editing ? (
          <>
            <button onClick={() => patch.mutate()} disabled={patch.isPending}>
              저장
            </button>
            <button className="ghost" onClick={() => setEditing(false)}>
              취소
            </button>
          </>
        ) : (
          <>
            <button onClick={() => scan.mutate()}>스캔</button>
            <button className="ghost" onClick={() => setEditing(true)}>
              편집
            </button>
            <button
              className="ghost danger-outline"
              onClick={() => {
                if (
                  window.confirm(
                    `루트 "${root.label ?? root.path}"를 제거합니다.\n` +
                      '관련 아카이브 레코드도 함께 삭제됩니다 (원본 파일은 그대로).',
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              제거
            </button>
          </>
        )}
      </div>
      {job && job.status !== 'done' && job.status !== 'failed' && (
        <div className="job">
          인덱싱 중… {Math.round((job.progress ?? 0) * 100)}%
        </div>
      )}
      {job?.status === 'done' && (
        <div className="job done">인덱싱 완료 ✓</div>
      )}
      {job?.status === 'failed' && (
        <p className="error">인덱싱 실패: {job.error}</p>
      )}
    </li>
  );
}

function RootsPanel() {
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');

  const roots = useQuery({ queryKey: ['roots'], queryFn: api.roots });

  const add = useMutation({
    mutationFn: () =>
      api.addRoot({
        path: path.trim(),
        label: label.trim() || undefined,
      }),
    onSuccess: () => {
      setPath('');
      setLabel('');
      qc.invalidateQueries({ queryKey: ['roots'] });
    },
  });

  return (
    <section className="settings-section">
      <h4>라이브러리 루트</h4>
      <p className="muted small">
        스캔할 경로를 등록하면 인덱서가 하위의 zip/cbz/rar/cbr 파일을 찾아 DB 에
        등록합니다. 원본은 변경되지 않습니다. cron 식을 지정하면 해당 일정에 자동
        스캔합니다.
      </p>
      <form
        className="settings-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) add.mutate();
        }}
      >
        <input
          placeholder="경로 (예: /media/photobooks)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <input
          placeholder="라벨(선택)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" disabled={add.isPending || !path.trim()}>
          추가
        </button>
      </form>
      {add.isError && <p className="error">{(add.error as Error).message}</p>}

      <ul className="root-list">
        {roots.data?.map((r) => <RootRow key={r.id} root={r} />)}
        {roots.data && roots.data.length === 0 && (
          <li className="muted small">등록된 루트가 없습니다.</li>
        )}
      </ul>
    </section>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <aside className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="settings-bar">
          <h3>설정</h3>
          <button className="ghost" onClick={onClose}>
            닫기 ✕
          </button>
        </header>
        <div className="settings-body">
          <RootsPanel />
          <AutoTagPanel />
          <DuplicatesPanel />
        </div>
      </aside>
    </div>
  );
}
