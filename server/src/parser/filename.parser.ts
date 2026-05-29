import { Injectable } from '@nestjs/common';
import { Country, Model, Publisher } from '@prisma/client';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';

export interface SuggestedEntity {
  name: string;
  aliases?: string[];
  existingId?: number;
}

export interface SuggestedCountry {
  code: string;
  name?: string;
  existingId?: number;
}

export interface ParsedSuggestion {
  source: string;
  country: SuggestedCountry | null;
  publisher: SuggestedEntity | null;
  models: SuggestedEntity[];
  title: string | null;
}

/** ` - `, ` — `, ` ─ `. 양쪽 공백 필수 — `-` 가 이름의 일부일 때 보호. */
const TITLE_SEP_RE = /\s+[-—─]\s+/;
/** 모델 다중 분리자: &, "and", +, ・, , (대소 무관) */
const MODEL_SEP_RE = /\s*(?:&|\band\b|\+|・|,)\s*/i;
/** 모델 이름 뒤 ( ... ) 안의 비-라틴 문자열 → 별칭 후보 */
const ALIAS_RE = /^(.+?)\s*\(([^)]*[぀-ヿ㐀-鿿가-힯][^)]*)\)\s*$/;
/** "Hikaru Aoyama (青山ひかる)" 같이 앞쪽에 위치한 모델+별칭 패턴 */
const LEADING_MODEL_ALIAS_RE =
  /^([A-Za-z][A-Za-z\s\-'.]+?)\s*\(([^)]*[぀-ヿ㐀-鿿가-힯][^)]*)\)/;
/** 2-3자 대문자 ASCII 만 있는 토큰 → 국가코드 후보 */
const COUNTRY_CODE_RE = /^[A-Z]{2,3}$/;

function stripExt(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function safeAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? (v as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function findByNameOrAlias<T extends { name: string }>(
  rows: T[],
  token: string,
  getAliases: (row: T) => string[] = () => [],
): T | undefined {
  const t = token.trim().toLowerCase();
  if (!t) return undefined;
  for (const row of rows) {
    if (row.name.trim().toLowerCase() === t) return row;
    if (getAliases(row).some((a) => a.trim().toLowerCase() === t)) return row;
  }
  return undefined;
}

@Injectable()
export class FilenameParserService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(fileName: string): Promise<ParsedSuggestion> {
    let rest = stripExt(fileName).trim();

    // 0) 선두 숫자 ID 제거 ("54762 - ", "12345_")
    rest = rest.replace(/^\d+\s*[-_]\s*/, '').trim();

    // 1) 선두 [...] 추출. 첫 brace 가 2~3자 대문자면 국가코드, 아니면 출판사 후보.
    //    여러 개가 연달아 올 수도 있어 한 번 더 시도.
    let countryToken: string | null = null;
    let publisherToken: string | null = null;
    for (let i = 0; i < 2; i++) {
      const m = rest.match(/^\s*\[([^\]]+)\]\s*/);
      if (!m) break;
      const inner = m[1].trim();
      rest = rest.slice(m[0].length);
      if (COUNTRY_CODE_RE.test(inner) && !countryToken) {
        countryToken = inner;
      } else if (!publisherToken) {
        publisherToken = inner;
      }
      // 둘 다 채워졌으면 더 안 봄
      if (countryToken && publisherToken) break;
    }

    // 2) 후미 (... photos), ( Page 1 2 ) 등 메타 노이즈 제거
    rest = rest
      .replace(/\(\s*\d+\s+photos?\s*\)/gi, '')
      .replace(/\(\s*Page\s+[\d\s]+\)/gi, '')
      .trim();

    // 3) 첫 " - " 로 좌(모델)/우(타이틀) 분리
    let modelsRaw = '';
    let title: string | null = null;
    if (TITLE_SEP_RE.test(rest)) {
      const idx = rest.search(TITLE_SEP_RE);
      const sepLen = rest.slice(idx).match(TITLE_SEP_RE)![0].length;
      modelsRaw = rest.slice(0, idx).trim();
      title = rest.slice(idx + sepLen).trim() || null;
    } else {
      title = rest || null;
    }

    // 4) 모델 토큰화 + 후행 (비-라틴) 별칭 분리
    let modelTokens: { name: string; aliases?: string[] }[] = [];
    if (modelsRaw) {
      const tokens = modelsRaw
        .split(MODEL_SEP_RE)
        .map((s) => s.trim())
        .filter(Boolean);
      modelTokens = tokens.map((token) => {
        const m = token.match(ALIAS_RE);
        if (m) {
          return { name: m[1].trim(), aliases: [m[2].trim()] };
        }
        return { name: token };
      });
    } else if (title) {
      // 분리자가 없으면 타이틀 앞쪽 "Latin (CJK)" 패턴을 모델로 시도
      const m = title.match(LEADING_MODEL_ALIAS_RE);
      if (m) {
        modelTokens = [{ name: m[1].trim(), aliases: [m[2].trim()] }];
        title = title.slice(m[0].length).trim() || null;
      }
    }

    // 타이틀 양끝의 군더더기(`-`, ` `) 정리
    if (title) {
      title = title.replace(/^[\s\-—─]+/, '').replace(/[\s\-—─]+$/, '').trim() || null;
    }

    // 5) DB 매칭
    const [countries, publishers, models] = await Promise.all([
      this.prisma.country.findMany(),
      this.prisma.publisher.findMany(),
      this.prisma.model.findMany(),
    ]);

    const matchedCountry: SuggestedCountry | null = countryToken
      ? (() => {
          const existing = countries.find(
            (c: Country) =>
              c.code.toUpperCase() === countryToken!.toUpperCase(),
          );
          return {
            code: countryToken!.toUpperCase(),
            name: existing?.name,
            existingId: existing?.id,
          };
        })()
      : null;

    const matchedPublisher = publisherToken
      ? findByNameOrAlias<Publisher>(publishers, publisherToken)
      : undefined;

    const matchedModels: SuggestedEntity[] = modelTokens.map((tok) => {
      // 별칭 후보도 함께 매칭에 활용
      const hit =
        findByNameOrAlias<Model>(models, tok.name, (m) =>
          safeAliases(m.aliases),
        ) ??
        (tok.aliases
          ? findByNameOrAlias<Model>(models, tok.aliases[0], (m) =>
              safeAliases(m.aliases),
            )
          : undefined);
      return {
        name: hit?.name ?? tok.name,
        aliases: tok.aliases,
        existingId: hit?.id,
      };
    });

    return {
      source: fileName,
      country: matchedCountry,
      publisher: publisherToken
        ? {
            name: matchedPublisher?.name ?? publisherToken,
            existingId: matchedPublisher?.id,
          }
        : null,
      models: matchedModels,
      title,
    };
  }
}
