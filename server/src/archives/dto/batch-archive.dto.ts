import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BatchSetDto {
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
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  rating?: number | null;
}

export class BatchArchiveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BatchSetDto)
  set?: BatchSetDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  addTags?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  removeTags?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  addModels?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  removeModels?: number[];
}
