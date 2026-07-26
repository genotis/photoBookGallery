import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const MATCH_TYPES = ['glob', 'regex'] as const;

export class CreateExclusionDto {
  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: 'glob' | 'regex';

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  pattern!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class PatchExclusionDto {
  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: 'glob' | 'regex';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  pattern?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** 패턴 테스트 — 샘플 파일명들이 매칭되는지 즉시 확인. */
export class TestExclusionDto {
  @IsIn(MATCH_TYPES)
  matchType!: 'glob' | 'regex';

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsInt()
  @IsOptional()
  archiveId?: number;
}
