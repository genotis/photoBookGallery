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
  /** 콘텐츠 해시. 재압축 시 바뀌므로 이미지 URL 의 캐시 버스터로 활용. */
  contentHash: string;
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
  nameEn?: string | null;
  aliases?: string[];
  profileImg?: string | null;
  bio?: string | null;
  favorite?: boolean;
  count?: number;
  cover?: { archiveId: number; contentHash: string } | null;
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

export type AssignTarget =
  | 'country'
  | 'model'
  | 'publisher'
  | 'series'
  | 'title'
  | 'tag';

export interface RuleAssignment {
  target: AssignTarget;
  source: 'group' | 'literal';
  key?: string;
  value?: string;
}

export interface ClassifyRule {
  id: number;
  name: string;
  priority: number;
  enabled: boolean;
  rootId: number | null;
  matchType: 'regex' | 'glob';
  pattern: string;
  destTemplate: string;
  assignments: RuleAssignment[];
  scanCron: string | null;
  scheduleOn: boolean;
  batchLimit: number | null;
  lastRunAt: string | null;
}

export interface ClassifyRuleInput {
  name: string;
  priority?: number;
  enabled?: boolean;
  rootId?: number | null;
  matchType?: 'regex' | 'glob';
  pattern: string;
  destTemplate?: string;
  assignments?: RuleAssignment[];
  scanCron?: string | null;
  scheduleOn?: boolean;
  batchLimit?: number | null;
}

export type ClassifyStatus = 'move' | 'noop' | 'conflict' | 'error' | 'none';

export interface ClassifyPreviewItem {
  archiveId: number;
  fileName: string;
  currentPath: string;
  status: ClassifyStatus;
  ruleId: number | null;
  ruleName: string | null;
  matchCount: number;
  tagChanges: string[];
  rootId: number;
  rootLabel: string | null;
  rootPath: string;
  destPath: string | null;
  destRel: string | null;
  message?: string;
}

export interface ClassifyPreview {
  total: number;
  willMove: number;
  willTag: number;
  sampled: number;
  items: ClassifyPreviewItem[];
}

export interface RuleSuggestion {
  country: { code: string; name?: string; existingId?: number } | null;
  publisher: { name: string; existingId?: number } | null;
  series: { name: string; existingId?: number } | null;
  title: string | null;
  models: { name: string; existingId?: number }[];
  tags: { name: string; existingId?: number }[];
  matchedRules: string[];
}

export interface ClassifyMove {
  id: number;
  archiveId: number;
  contentHash: string;
  fileName: string;
  fromPath: string;
  toPath: string;
  jobId: number | null;
  ruleId: number | null;
  ruleName: string | null;
  status: 'moved' | 'reverted';
  createdAt: string;
  revertedAt: string | null;
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

  /** 사이드바 "랜덤" 메뉴 — 매 호출 다른 N개를 반환. */
  randomArchives: (n: number) =>
    request<{ items: ArchiveListItem[] }>(`/archives/random?n=${n}`),

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
  patchModel: (
    id: number,
    data: {
      name?: string;
      nameEn?: string;
      aliases?: string[];
      profileImg?: string;
      bio?: string;
      favorite?: boolean;
    },
  ) =>
    request<ModelRef>(`/models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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

  // ---- 파일 분류 / 태깅 규칙 ----
  /** 단일 아카이브 규칙 기반 메타/태그 제안 (MetaPanel "규칙으로 추정"). */
  classifySuggest: (archiveId: number) =>
    request<RuleSuggestion>(`/classify/suggest/${archiveId}`),
  classifyRules: () => request<ClassifyRule[]>('/classify/rules'),
  createClassifyRule: (data: ClassifyRuleInput) =>
    request<ClassifyRule>('/classify/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchClassifyRule: (id: number, data: Partial<ClassifyRuleInput>) =>
    request<ClassifyRule>(`/classify/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  removeClassifyRule: (id: number) =>
    request<{ ok: true }>(`/classify/rules/${id}`, { method: 'DELETE' }),
  classifyPreview: (ruleIds?: number[], sampleLimit = 50, pathPrefix?: string) =>
    request<ClassifyPreview>('/classify/preview', {
      method: 'POST',
      body: JSON.stringify({ ruleIds, sampleLimit, pathPrefix }),
    }),
  classifyApply: (
    ruleIds?: number[],
    force = false,
    limit?: number,
    pathPrefix?: string,
  ) =>
    request<{ jobId: number }>('/classify/apply', {
      method: 'POST',
      body: JSON.stringify({ ruleIds, force, limit, pathPrefix }),
    }),
  classifyExport: () =>
    request<{
      type: string;
      version: number;
      exportedAt: string;
      count: number;
      rules: unknown[];
    }>('/classify/rules/export'),
  classifyImport: (
    data: { mode?: 'merge' | 'replace'; rules: unknown[] },
  ) =>
    request<{
      imported: number;
      skipped: number;
      errors: string[];
      warnings: string[];
    }>('/classify/rules/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  classifyHistory: (limit = 200) =>
    request<ClassifyMove[]>(`/classify/history?limit=${limit}`),
  classifyRevert: (payload: { moveIds?: number[]; jobId?: number }) =>
    request<{ jobId: number }>('/classify/revert', {
      method: 'POST',
      body: JSON.stringify(payload),
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

/**
 * 표지/페이지 이미지 URL 은 콘텐츠 해시(`v=`) 를 항상 부착한다.
 * - 재압축으로 같은 archiveId 의 같은 인덱스에 다른 콘텐츠가 매달리면 해시가 바뀌고
 *   URL 도 바뀌어, 브라우저 디스크 캐시에 남아 있던 immutable 응답을 자연스럽게 우회.
 * - 재압축이 없는 한 같은 URL 이라 캐시 효율도 유지.
 */
export const coverUrl = (id: number, contentHash?: string | null) =>
  `/api/archives/${id}/cover.webp${contentHash ? `?v=${contentHash.slice(0, 12)}` : ''}`;
export const pageUrl = (
  id: number,
  index: number,
  size = 'preview',
  contentHash?: string | null,
) =>
  `/api/archives/${id}/page/${index}?size=${size}` +
  (contentHash ? `&v=${contentHash.slice(0, 12)}` : '');
