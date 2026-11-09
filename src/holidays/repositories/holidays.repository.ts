import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlInsert, SqlRow } from '@common/types/sql-database.types';
import { callFunction } from 'src/database/sql-functions';
import IHolidayViewModel from '@modules/holidays/types/holiday.interface';

@Injectable()
export class HolidaysRepository extends SqlRepository<
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

  // In one transaction (replace_country_holidays): a policy's country
  // holidays of `year` are replaced by `holidays`, or nothing changes. The
  // company's own holidays stay.
  public async replaceCountryHolidays(
    params: { slackTeamId: string; vacationPolicyId: string; year: number },
    holidays: Pick<
      SqlInsert<'holidays'>,
      'name' | 'date' | 'country_code' | 'created_by' | 'updated_by'
    >[],
  ): Promise<IHolidayViewModel[]> {
    const rows = await callFunction(this.db, 'replace_country_holidays', {
      p_slack_team_id: params.slackTeamId,
      p_vacation_policy_id: params.vacationPolicyId,
      p_year: params.year,
      p_holidays: JSON.stringify(holidays),
    });

    return rows.map(this.mapToViewModel);
  }
}
