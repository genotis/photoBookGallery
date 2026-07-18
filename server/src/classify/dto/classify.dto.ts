import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

export const MATCH_TYPES = ['regex', 'glob'] as const;

export class CreateClassifyRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** 대상 루트. 미지정(null) 시 모든 루트. */
  @IsOptional()
  @IsInt()
  rootId?: number | null;

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsString()
  @MinLength(1)
  destTemplate!: string;

  @IsOptional()
  @IsString()
  scanCron?: string | null;

  @IsOptional()
  @IsBoolean()
  scheduleOn?: boolean;
}

export class PatchClassifyRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  rootId?: number | null;

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  pattern?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  destTemplate?: string;

  @IsOptional()
  @IsString()
  scanCron?: string | null;

  @IsOptional()
  @IsBoolean()
  scheduleOn?: boolean;
}

export class ClassifyPreviewDto {
  /** 특정 규칙만 미리보기. 미지정 시 enabled 규칙 전체. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @Type(() => Number)
  @IsInt({ each: true })
  ruleIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  sampleLimit?: number = 50;
}

export class ClassifyApplyDto {
  /** 적용할 규칙 id 목록. 미지정 시 enabled 규칙 전체. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @Type(() => Number)
  @IsInt({ each: true })
  ruleIds?: number[];

  /** true 면 규칙의 enabled 무시하고 지정한 ruleIds 를 강제 실행 (수동 실행용). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  force?: boolean;
}

export class ClassifyRevertDto {
  /** 원복할 이동 이력 id 목록. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @Type(() => Number)
  @IsInt({ each: true })
  moveIds?: number[];

  /** 특정 apply job 의 이동 전체를 원복. moveIds 와 함께 주면 AND. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  jobId?: number;
}
