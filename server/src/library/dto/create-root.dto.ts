import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRootDto {
  @IsString()
  @MinLength(1)
  path!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsString()
  scanCron?: string;
}

export class PatchRootDto {
  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsString()
  scanCron?: string | null;
}
