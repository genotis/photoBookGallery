import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UpsertModelDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  nameEn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  profileImg?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class PatchModelDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  nameEn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  profileImg?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}

export class MergeModelDto {
  @IsInt()
  @Min(1)
  intoId!: number;
}
