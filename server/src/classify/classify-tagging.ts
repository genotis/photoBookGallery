/**
 * 규칙의 태깅 액션(assignments) 파싱 + 여러 매칭 규칙에 걸친 누적(스택).
 * 순수 함수만 — 엔티티 생성/DB 는 서비스가 담당.
 */

export const ASSIGN_TARGETS = [
  'country',
  'model',
  'publisher',
  'series',
  'title',
  'tag',
] as const;
export type AssignTarget = (typeof ASSIGN_TARGETS)[number];

export const ASSIGN_SOURCES = ['group', 'literal'] as const;
export type AssignSource = (typeof ASSIGN_SOURCES)[number];

export interface Assignment {
  target: AssignTarget;
  source: AssignSource;
  /** source=group 일 때 정규식 named group 이름. */
  key?: string;
  /** source=literal 일 때 리터럴 값. */
  value?: string;
}

/** 누적된 태깅 계획. 단일값 필드 + 다중값(models/tags). */
export interface TagPlan {
  country?: string; // 코드
  publisher?: string; // 이름
  series?: string; // 이름
  title?: string;
  models: string[]; // 이름 (dedup)
  tags: string[]; // 이름 (dedup)
}

/** rule.assignments(JSON 문자열) → Assignment[]. 형식 오류는 무시. */
export function parseAssignments(raw: string | null | undefined): Assignment[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Assignment[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const target = o.target;
    const source = o.source;
    if (
      typeof target !== 'string' ||
      !(ASSIGN_TARGETS as readonly string[]).includes(target)
    )
      continue;
    if (
      typeof source !== 'string' ||
      !(ASSIGN_SOURCES as readonly string[]).includes(source)
    )
      continue;
    out.push({
      target: target as AssignTarget,
      source: source as AssignSource,
      key: typeof o.key === 'string' ? o.key : undefined,
      value: typeof o.value === 'string' ? o.value : undefined,
    });
  }
  return out;
}

/** 규칙 검증용 — assignments 배열이 형식상 유효한지. */
export function validateAssignments(arr: Assignment[]): string | null {
  for (const a of arr) {
    if (a.source === 'group' && !a.key?.trim()) {
      return `'${a.target}' 그룹 소스에 group 이름이 없습니다.`;
    }
    if (a.source === 'literal' && !a.value?.trim()) {
      return `'${a.target}' 리터럴 소스에 값이 없습니다.`;
    }
  }
  return null;
}

/** 한 assignment 의 값 해석 — group 이면 tokens 에서, literal 이면 value. */
function resolveValue(
  a: Assignment,
  tokens: Record<string, string>,
): string | undefined {
  const raw =
    a.source === 'literal' ? a.value : a.key ? tokens[a.key] : undefined;
  const v = raw?.trim();
  return v || undefined;
}

function pushUnique(list: string[], v: string): void {
  if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
}

/**
 * 매칭된 규칙들(우선순위 순)의 assignments 를 누적해 TagPlan 을 만든다.
 * - 단일값(country/publisher/series/title): 첫 비어있지 않은 값이 우선(먼저 온 규칙).
 * - 다중값(model/tag): 모두 수집(대소문자 무시 중복 제거).
 */
export function buildTagPlan(
  matches: { assignments: Assignment[]; tokens: Record<string, string> }[],
): TagPlan {
  const plan: TagPlan = { models: [], tags: [] };
  for (const m of matches) {
    for (const a of m.assignments) {
      const v = resolveValue(a, m.tokens);
      if (!v) continue;
      switch (a.target) {
        case 'country':
          if (!plan.country) plan.country = v.toUpperCase();
          break;
        case 'publisher':
          if (!plan.publisher) plan.publisher = v;
          break;
        case 'series':
          if (!plan.series) plan.series = v;
          break;
        case 'title':
          if (!plan.title) plan.title = v;
          break;
        case 'model':
          pushUnique(plan.models, v);
          break;
        case 'tag':
          pushUnique(plan.tags, v);
          break;
      }
    }
  }
  return plan;
}
