import { extname, isAbsolute, join, relative, resolve, sep } from 'path';

/**
 * 글롭 → RegExp. 지원: `*`(임의 문자열), `?`(1자), 나머지는 리터럴.
 * 파일명 한 조각에만 적용하므로 `**` 구분은 두지 않는다.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (const ch of glob) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** 규칙의 matchType/pattern 을 RegExp 로 컴파일. 잘못된 패턴이면 예외. */
export function compileMatcher(matchType: string, pattern: string): RegExp {
  if (matchType === 'glob') return globToRegExp(pattern);
  // regex: 사용자가 앞뒤 앵커를 직접 넣지 않아도 부분 매칭 허용
  return new RegExp(pattern, 'i');
}

/** 파일명에 대한 매칭 결과 + 템플릿용 토큰 집합. */
export interface MatchTokens {
  matched: boolean;
  tokens: Record<string, string>;
}

/**
 * 파일명 매칭 후 템플릿용 토큰을 만든다.
 * 내장: {fileName} {stem} {ext} {format}. 정규식 named group 은 그대로 노출.
 */
export function matchFile(re: RegExp, fileName: string): MatchTokens {
  const m = re.exec(fileName);
  if (!m) return { matched: false, tokens: {} };

  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  const extNoDot = ext.replace(/^\./, '').toLowerCase();

  const tokens: Record<string, string> = {
    fileName,
    stem,
    ext: extNoDot,
    format: extNoDot,
  };
  if (m.groups) {
    for (const [k, v] of Object.entries(m.groups)) {
      if (v !== undefined) tokens[k] = v;
    }
  }
  return { matched: true, tokens };
}

/** 경로 조각에서 안전하지 않은 문자를 제거. 구분자/제어문자/양끝 점 정리. */
export function sanitizeSegment(value: string): string {
  return value
    .replace(/[/\\]/g, '_') // 경로 구분자 → 침투 방지
    .replace(/[\p{Cc}<>:"|?*]/gu, '') // 제어문자 + 파일시스템 금지문자
    .replace(/^\.+|\.+$/g, '') // 앞뒤 점 (".", ".." 방지)
    .trim();
}

export class TemplateError extends Error {}

/**
 * destTemplate 을 토큰으로 렌더링해 (루트 상대) 하위경로를 만든다.
 * - `{token}` 치환. 미정의/빈 토큰이면 TemplateError.
 * - 각 경로 조각을 sanitize. 빈 조각은 제거.
 * - 결과가 비면 TemplateError (목적지 없음).
 */
export function renderTemplate(
  template: string,
  tokens: Record<string, string>,
): string {
  // 토큰 값은 치환 시점에 sanitize — 값 내부의 구분자가 새 경로 계층을 만들지
  // 않도록 `_` 로 접는다. 구조(경로 계층)는 오직 템플릿의 리터럴 `/` 로만 결정.
  const replaced = template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const key = name.trim();
    const v = tokens[key];
    if (v === undefined || v === '') {
      throw new TemplateError(`템플릿 토큰 '{${key}}' 값이 없습니다.`);
    }
    return sanitizeSegment(v);
  });

  const segments = replaced
    .split(/[/\\]+/)
    .map((s) => sanitizeSegment(s))
    .filter(Boolean);

  if (segments.length === 0) {
    throw new TemplateError('템플릿이 빈 경로를 만들었습니다.');
  }
  return segments.join('/');
}

/**
 * 루트 하위로 안전하게 결합. 결과가 루트를 벗어나면(`..` 등) null.
 * rootPath / subPath 모두 절대·정규화 후 prefix 검증.
 */
export function safeResolveUnderRoot(
  rootPath: string,
  subPath: string,
): string | null {
  const root = resolve(rootPath);
  const full = resolve(join(root, subPath));
  const rel = relative(root, full);
  if (
    rel === '' ||
    isAbsolute(rel) ||
    rel === '..' ||
    rel.startsWith('..' + sep)
  ) {
    return null;
  }
  return full;
}
