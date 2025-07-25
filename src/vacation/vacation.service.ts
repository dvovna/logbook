import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';

@Injectable()
export class VacationService {
  public constructor(private supabase: SupabaseService) {}

  // public async getVacationBalance(userId: string, year: number) {
  //   const { data, error } = await this.supabase
  //     .getClient()
  //     .from('vacations')
  //     .select('*')
  //     .eq('user_id', userId)
  //     .eq('year', year)
  //     .single();
  //
  //   if (error || !data) {
  //     throw new Error(
  //       'No vacation balance found for the user in the specified year.',
  //     );
  //   }
  //
  //   const remainingDays = data.total_days - data.used_days;
  //
  //   return {
  //     remainingDays,
  //     bonusDays: data.bonus_days,
  //   };
  // }
}
