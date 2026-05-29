import { IsOptional, IsString, Length } from 'class-validator';

export class UpsertSeriesDto {
  @IsString()
  @Length(1, 128)
  name!: string;
}

export class PatchSeriesDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;
}
