import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
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

export class ListArchivesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 60;

  @IsOptional()
  @IsIn(['name', 'mtime', 'pageCount', 'rating', 'createdAt'])
  sort = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';

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

  // 분류 필터 — id 또는 콤마구분 id 목록 허용
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

  // 등록된 라이브러리 루트 하위 절대 경로의 prefix. 루트 화이트리스트는
  // 인덱싱 시점에 강제되므로 여기서는 단순 prefix 매칭만 한다.
  @IsOptional()
  @IsString()
  pathPrefix?: string;
}
