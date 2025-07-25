import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsNumber()
  public vacation_days: number;

  @IsNumber()
  public bonus_days: number;

  @IsOptional()
  @IsString()
  public command?: string;

  @IsString()
  public text: string;
}
