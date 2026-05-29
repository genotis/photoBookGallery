import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

export class AutoTagDto {
  /** 대상 아카이브 id 목록. 미지정 시 전체. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @Type(() => Number)
  @IsInt({ each: true })
  ids?: number[];

  /** true 면 메타데이터가 비어있는 아카이브만 (기본 true). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  onlyMissing?: boolean = true;
}

export class AutoTagPreviewDto extends AutoTagDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  sampleLimit?: number = 50;
}
