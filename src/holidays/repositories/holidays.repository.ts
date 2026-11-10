import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import IHolidayViewModel from '@modules/holidays/types/holiday.interface';

@Injectable()
export class HolidaysRepository extends BaseRepository<
  'holidays',
  IHolidayViewModel
> {
  protected readonly tableName = 'holidays';

  protected mapToViewModel = (row: SqlRow<'holidays'>) => {
    return {
      id: row.id,
      name: row.name,
      is_company_custom: row.is_company_custom,
      date: row.date,
      country_code: row.country_code,
      is_disabled: row.is_disabled,
      slack_team_id: row.slack_team_id,
      vacation_policy_id: row.vacation_policy_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
    };
  };
}
