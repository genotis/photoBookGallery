import { IsOptional, IsString, Length } from 'class-validator';

export class UpsertTagDto {
  @IsString()
  @Length(1, 64)
  name!: string;
}

export class PatchTagDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;
}
