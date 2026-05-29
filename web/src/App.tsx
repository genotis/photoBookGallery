import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Login } from './components/Login';
import { RootsBar } from './components/RootsBar';
import { ArchiveGrid } from './components/ArchiveGrid';

export function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  if (me.isLoading) {
    return <main className="center">로딩 중…</main>;
  }

  if (!me.data?.authenticated) {
    return <Login onSuccess={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  }

  const ok = health.data?.status === 'ok' && health.data?.db === 'up';

  return (
    <div className="app">
      <header className="app-bar">
        <h1>photoBookGallery</h1>
        <div className="app-bar-right">
          <span className={`badge ${ok ? 'ok' : 'down'}`}>
            DB {health.data?.db ?? '?'}
          </span>
          <button
            className="ghost"
            onClick={async () => {
              await api.logout();
              qc.invalidateQueries({ queryKey: ['me'] });
            }}
          >
            로그아웃
          </button>
        </div>
      </header>
      <div className="app-body">
        <RootsBar />
        <ArchiveGrid />
      </div>
    </div>
  );
}
