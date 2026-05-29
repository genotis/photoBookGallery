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
  scanCron: string | null;
  _count: { archives: number };
}

export interface ArchiveListItem {
  id: number;
  fileName: string;
  title: string | null;
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

export interface ArchiveDetail {
  id: number;
  fileName: string;
  title: string | null;
  format: string;
  pageCount: number;
  favorite: boolean;
  rating: number | null;
  note: string | null;
  coverEntry: string | null;
  publishedAt: string | null;
  country: { id: number; code: string; name: string } | null;
  publisher: { id: number; name: string; kind: string | null } | null;
  series: { id: number; name: string } | null;
  models: { archiveId: number; modelId: number; model: { id: number; name: string } }[];
  tags: { archiveId: number; tagId: number; tag: { id: number; name: string } }[];
}

export interface Job {
  id: number;
  type: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress: number;
  error: string | null;
  payload?: string;
}

export interface ArchiveEntry {
  order: number;
  name: string;
}

export interface CountryRef {
  id: number;
  code: string;
  name: string;
  count?: number;
}

export interface PublisherRef {
  id: number;
  name: string;
  kind?: string | null;
  count?: number;
}

export interface SeriesRef {
  id: number;
  name: string;
  count?: number;
}

export interface TagRef {
  id: number;
  name: string;
  count?: number;
}

export interface ModelRef {
  id: number;
  name: string;
  aliases?: string[];
  profileImg?: string | null;
  bio?: string | null;
  count?: number;
}

export interface Facets {
  models: { id: number; name: string; count: number }[];
  publishers: { id: number; name: string; count: number }[];
  countries: { id: number; code: string; name: string; count: number }[];
  series: { id: number; name: string; count: number }[];
  tags: { id: number; name: string; count: number }[];
}

export interface ListParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
  favorite?: boolean;
  format?: string;
  ratingMin?: number;
  country?: number[];
  publisher?: number[];
  series?: number[];
  model?: number[];
  tag?: number[];
  pathPrefix?: string;
}

export interface TreeRoot {
  id: number;
  path: string;
  label: string | null;
  archiveCount: number;
}
export interface TreeChild {
  name: string;
  path: string;
  archiveCount: number;
}
export interface TreeResponse {
  path: string | null;
  rootId?: number;
  roots: TreeRoot[];
  children: TreeChild[];
}

export interface PatchArchivePayload {
  countryId?: number | null;
  publisherId?: number | null;
  seriesId?: number | null;
  modelIds?: number[];
  tagIds?: number[];
  rating?: number | null;
  favorite?: boolean;
  note?: string | null;
  publishedAt?: string | null;
  coverEntry?: string | null;
  title?: string | null;
}

export interface BatchPayload {
  ids: number[];
  set?: {
    countryId?: number | null;
    publisherId?: number | null;
    seriesId?: number | null;
    favorite?: boolean;
    rating?: number | null;
  };
  addTags?: number[];
  removeTags?: number[];
  addModels?: number[];
  removeModels?: number[];
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

function toQueryString(params: Record<string, unknown> | object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) qs.set(k, v.join(','));
    } else {
      qs.set(k, String(v));
    }
  }
  return qs.toString();
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
  addRoot: (data: {
    path: string;
    label?: string;
    scanCron?: string | null;
  }) =>
    request<Root>('/roots', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchRoot: (
    id: number,
    data: { label?: string | null; scanCron?: string | null },
  ) =>
    request<Root>(`/roots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  removeRoot: (id: number) =>
    request<{ ok: true }>(`/roots/${id}`, { method: 'DELETE' }),
  scanRoot: (id: number) =>
    request<{ jobId: number }>(`/roots/${id}/scan`, { method: 'POST' }),

  job: (id: number) => request<Job>(`/jobs/${id}`),

  archives: (params: ListParams) =>
    request<ArchivePage>(`/archives?${toQueryString(params)}`),

  archiveDetail: (id: number) => request<ArchiveDetail>(`/archives/${id}`),

  patchArchive: (id: number, payload: PatchArchivePayload) =>
    request<ArchiveDetail>(`/archives/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  batchArchives: (payload: BatchPayload) =>
    request<{ updated: number }>(`/archives/batch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  entries: (id: number) => request<ArchiveEntry[]>(`/archives/${id}/entries`),

  // ---- 분류 엔티티 ----
  countries: (q?: string) =>
    request<CountryRef[]>(`/countries${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createCountry: (code: string, name: string) =>
    request<CountryRef>('/countries', {
      method: 'POST',
      body: JSON.stringify({ code, name }),
    }),

  publishers: (q?: string) =>
    request<PublisherRef[]>(`/publishers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createPublisher: (name: string, kind?: string) =>
    request<PublisherRef>('/publishers', {
      method: 'POST',
      body: JSON.stringify({ name, kind }),
    }),

  series: (q?: string) =>
    request<SeriesRef[]>(`/series${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createSeries: (name: string) =>
    request<SeriesRef>('/series', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  tags: (q?: string) =>
    request<TagRef[]>(`/tags${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createTag: (name: string) =>
    request<TagRef>('/tags', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  models: (q?: string) =>
    request<ModelRef[]>(`/models${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createModel: (name: string, aliases?: string[]) =>
    request<ModelRef>('/models', {
      method: 'POST',
      body: JSON.stringify({ name, aliases }),
    }),
  mergeModel: (fromId: number, intoId: number) =>
    request<ModelRef>(`/models/${fromId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ intoId }),
    }),

  // ---- 검색 / 패싯 ----
  search: (q: string) =>
    request<{
      archives: ArchiveListItem[];
      models: { id: number; name: string; count: number }[];
      tags: { id: number; name: string; count: number }[];
    }>(`/search?${toQueryString({ q })}`),

  facets: (params: Omit<ListParams, 'page' | 'limit' | 'sort' | 'order'>) =>
    request<Facets>(`/facets?${toQueryString(params)}`),

  // ---- 재압축(편집) ----
  repack: (archiveId: number, excludeEntries: string[]) =>
    request<{ jobId: number; status: string }>(
      `/archives/${archiveId}/repack`,
      {
        method: 'POST',
        body: JSON.stringify({ excludeEntries }),
      },
    ),
  repackStatus: (archiveId: number, jobId: number) =>
    request<Job>(`/archives/${archiveId}/repack/${jobId}`),

  tree: (path?: string) =>
    request<TreeResponse>(
      `/tree${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),

  suggestions: (archiveId: number) =>
    request<{
      source: string;
      country: {
        code: string;
        name?: string;
        existingId?: number;
      } | null;
      publisher: { name: string; existingId?: number } | null;
      models: {
        name: string;
        aliases?: string[];
        existingId?: number;
      }[];
      title: string | null;
    }>(`/archives/${archiveId}/suggestions`),

  autoTagPreview: (onlyMissing: boolean, sampleLimit = 20) =>
    request<{
      total: number;
      sampled: number;
      items: {
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
      }[];
    }>('/auto-tag/preview', {
      method: 'POST',
      body: JSON.stringify({ onlyMissing, sampleLimit }),
    }),

  autoTagApply: (onlyMissing: boolean) =>
    request<{ jobId: number }>('/auto-tag/apply', {
      method: 'POST',
      body: JSON.stringify({ onlyMissing }),
    }),

  duplicatesScan: () =>
    request<{ jobId: number }>('/duplicates/scan', { method: 'POST' }),

  duplicatesLatest: () =>
    request<{
      scannedAt: string;
      totalFiles: number;
      hashedFiles: number;
      reusedHashes: number;
      duplicateSets: {
        contentHash: string;
        size: number;
        paths: { rootId: number; path: string }[];
      }[];
    } | null>('/duplicates/latest'),
};

export const coverUrl = (id: number) => `/api/archives/${id}/cover.webp`;
export const pageUrl = (id: number, index: number, size = 'preview') =>
  `/api/archives/${id}/page/${index}?size=${size}`;
