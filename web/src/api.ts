export interface HealthResponse {
  status: string;
  db: 'up' | 'down';
  ts: string;
}

export interface MeResponse {
  authenticated: boolean;
}

export interface Root {
  id: number;
  path: string;
  label: string | null;
  readOnly: boolean;
  _count: { archives: number };
}

export interface ArchiveListItem {
  id: number;
  fileName: string;
  format: string;
  pageCount: number;
  favorite: boolean;
  rating: number | null;
  hasCover: boolean;
  missing: boolean;
  publisher: { id: number; name: string } | null;
  models: { id: number; name: string }[];
}

export interface ArchivePage {
  items: ArchiveListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface Job {
  id: number;
  type: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress: number;
  error: string | null;
}

export interface ArchiveEntry {
  order: number;
  name: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface ListParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
  favorite?: boolean;
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  me: () => request<MeResponse>('/auth/me'),
  login: (password: string) =>
    request<{ ok: true }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  roots: () => request<Root[]>('/roots'),
  addRoot: (path: string, label?: string) =>
    request<Root>('/roots', {
      method: 'POST',
      body: JSON.stringify({ path, label }),
    }),
  removeRoot: (id: number) =>
    request<{ ok: true }>(`/roots/${id}`, { method: 'DELETE' }),
  scanRoot: (id: number) =>
    request<{ jobId: number }>(`/roots/${id}/scan`, { method: 'POST' }),

  job: (id: number) => request<Job>(`/jobs/${id}`),

  archives: (params: ListParams) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    return request<ArchivePage>(`/archives?${qs.toString()}`);
  },
  entries: (id: number) => request<ArchiveEntry[]>(`/archives/${id}/entries`),
};

export const coverUrl = (id: number) => `/api/archives/${id}/cover.webp`;
export const pageUrl = (id: number, index: number, size = 'preview') =>
  `/api/archives/${id}/page/${index}?size=${size}`;
