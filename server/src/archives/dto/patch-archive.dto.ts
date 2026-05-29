import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 메타 수정. 명시적으로 보낸 필드만 갱신한다.
 * null 을 보내면 해당 필드를 비운다(외래키 해제 등).
 */
export class PatchArchiveDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  countryId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  publisherId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  seriesId?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  modelIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  tagIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  rating?: number | null;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverEntry?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string | null;
}
