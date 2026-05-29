export interface Filters {
  q: string;
  sort: string;
  order: 'asc' | 'desc';
  favorite?: boolean;
  ratingMin?: number;
  country?: number[];
  publisher?: number[];
  series?: number[];
  model?: number[];
  tag?: number[];
  pathPrefix?: string;
}

export const INITIAL_FILTERS: Filters = {
  q: '',
  sort: 'createdAt',
  order: 'desc',
};

export function toggleId(
  arr: number[] | undefined,
  id: number,
): number[] | undefined {
  const set = new Set(arr ?? []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return set.size ? Array.from(set) : undefined;
}
