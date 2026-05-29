import { IsOptional, IsString, Length } from 'class-validator';

export class UpsertCountryDto {
  @IsString()
  @Length(2, 8)
  code!: string;

  @IsString()
  @Length(1, 64)
  name!: string;
}

export class PatchCountryDto {
  @IsOptional()
  @IsString()
  @Length(2, 8)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;
}
