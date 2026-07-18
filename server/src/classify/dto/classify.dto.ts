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
  ValidateNested,
} from 'class-validator';
import { ASSIGN_SOURCES, ASSIGN_TARGETS } from '../classify-tagging';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

export const MATCH_TYPES = ['regex', 'glob'] as const;

/** 규칙의 태깅 액션 한 건. */
export class AssignmentDto {
  @IsIn(ASSIGN_TARGETS)
  target!: string;

  @IsIn(ASSIGN_SOURCES)
  source!: string;

  /** source=group 일 때 정규식 named group 이름. */
  @IsOptional()
  @IsString()
  key?: string;

  /** source=literal 일 때 리터럴 값. */
  @IsOptional()
  @IsString()
  value?: string;
}

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

  /** 이동 목적지 템플릿(루트 상대). 빈값/미지정이면 이동 안 함(태깅만). */
  @IsOptional()
  @IsString()
  destTemplate?: string;

  /** 태깅 액션 목록. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments?: AssignmentDto[];

  @IsOptional()
  @IsString()
  scanCron?: string | null;

  @IsOptional()
  @IsBoolean()
  scheduleOn?: boolean;

  /** 한 실행에서 이동할 최대 건수. null/미지정이면 무제한. */
  @IsOptional()
  @IsInt()
  @Min(1)
  batchLimit?: number | null;
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
  destTemplate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments?: AssignmentDto[];

  @IsOptional()
  @IsString()
  scanCron?: string | null;

  @IsOptional()
  @IsBoolean()
  scheduleOn?: boolean;

  /** 한 실행에서 이동할 최대 건수. null 이면 무제한. */
  @IsOptional()
  @IsInt()
  @Min(1)
  batchLimit?: number | null;
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

  /** 이번 실행에서 이동할 최대 건수. 미지정이면 무제한. 스케줄러는 규칙의 batchLimit 을 전달. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export const IMPORT_MODES = ['merge', 'replace'] as const;

/** 백업 파일 한 건의 규칙. 루트는 이식성을 위해 rootPath(경로 스냅샷)로 매칭. */
export class ImportRuleItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsOptional()
  @IsString()
  destTemplate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments?: AssignmentDto[];

  @IsOptional()
  @IsString()
  scanCron?: string | null;

  @IsOptional()
  @IsBoolean()
  scheduleOn?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  batchLimit?: number | null;

  /** 대상 루트 경로 스냅샷. import 시 이 경로로 루트를 찾아 연결(없으면 모든 루트). */
  @IsOptional()
  @IsString()
  rootPath?: string | null;
}

export class ImportClassifyRulesDto {
  /** merge: 기존 규칙 유지하고 추가. replace: 기존 전체 삭제 후 대체. */
  @IsOptional()
  @IsIn(IMPORT_MODES)
  mode?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportRuleItemDto)
  rules!: ImportRuleItemDto[];
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
