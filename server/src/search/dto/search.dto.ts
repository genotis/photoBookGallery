import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true;

const toIntArray = ({ value }: { value: unknown }): number[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const out: number[] = [];
  for (const v of arr) {
    const n = Number(v);
    if (Number.isFinite(n) && Number.isInteger(n)) out.push(n);
  }
  return out;
};

export class SearchDto {
  @IsString()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/**
 * 패싯은 아카이브 목록과 동일한 필터를 사용해 현재 결과집합 기준의 카운트를 반환한다.
 * (자기 자신 차원은 제외하지 않는 단순 구현 — 단계 2 MVP)
 */
export class FacetsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeMissing?: boolean;

  @IsOptional()
  @Transform(toIntArray)
  country?: number[];

  @IsOptional()
  @Transform(toIntArray)
  publisher?: number[];

  @IsOptional()
  @Transform(toIntArray)
  series?: number[];

  @IsOptional()
  @Transform(toIntArray)
  model?: number[];

  @IsOptional()
  @Transform(toIntArray)
  tag?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  ratingMin?: number;

  @IsOptional()
  @IsString()
  pathPrefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topN = 50;
}
