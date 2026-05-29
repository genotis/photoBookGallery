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
}
