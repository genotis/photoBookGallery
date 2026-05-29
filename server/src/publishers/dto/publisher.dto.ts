import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpsertPublisherDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  kind?: string;
}

export class PatchPublisherDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  kind?: string;
}
