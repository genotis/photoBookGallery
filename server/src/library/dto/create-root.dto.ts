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
}
