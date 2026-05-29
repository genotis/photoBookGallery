import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  if (me.isLoading) {
    return <main className="center">로딩 중…</main>;
  }

  return (
    <main className="container">
      <header>
        <h1>photoBookGallery</h1>
        <HealthBadge
          status={health.data?.status}
          db={health.data?.db}
        />
      </header>

      {me.data?.authenticated ? (
        <Authenticated
          onLogout={async () => {
            await api.logout();
            qc.invalidateQueries({ queryKey: ['me'] });
          }}
        />
      ) : (
        <LoginForm
          onSuccess={() => qc.invalidateQueries({ queryKey: ['me'] })}
        />
      )}
    </main>
  );
}

function HealthBadge({ status, db }: { status?: string; db?: string }) {
  const ok = status === 'ok' && db === 'up';
  return (
    <span className={`badge ${ok ? 'ok' : 'down'}`}>
      서버 {status ?? '?'} · DB {db ?? '?'}
    </span>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess,
  });

  return (
    <section className="card">
      <h2>로그인</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? '확인 중…' : '입장'}
        </button>
      </form>
      {login.isError && (
        <p className="error">{(login.error as Error).message}</p>
      )}
    </section>
  );
}

function Authenticated({ onLogout }: { onLogout: () => void }) {
  return (
    <section className="card">
      <p>✅ 인증되었습니다. 라이브러리 기능은 단계 1에서 구현됩니다.</p>
      <button onClick={onLogout}>로그아웃</button>
    </section>
  );
}
