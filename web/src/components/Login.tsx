import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess,
  });

  return (
    <main className="center">
      <section className="card" style={{ minWidth: 320 }}>
        <h2>photoBookGallery</h2>
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
    </main>
  );
}
