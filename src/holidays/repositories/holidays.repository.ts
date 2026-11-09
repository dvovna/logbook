import { Json } from '@common/types/database.types';
import { RpcFunctionName } from '@common/enums/rpc-function-name';
import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import IHolidayViewModel from '@modules/holidays/types/holiday.interface';

@Injectable()
export class HolidaysRepository extends BaseRepository<
  Tables['holidays'],
  IHolidayViewModel
> {
  protected tableName: TableName = 'holidays';

  protected mapToViewModel = (row: Tables['holidays']['Row']) => {
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
      Tables['holidays']['Insert'],
      'name' | 'date' | 'country_code' | 'created_by' | 'updated_by'
    >[],
  ): Promise<IHolidayViewModel[]> {
    const { data, error } = await this.client.rpc(
      RpcFunctionName.ReplaceCountryHolidays,
      {
        p_slack_team_id: params.slackTeamId,
        p_vacation_policy_id: params.vacationPolicyId,
        p_year: params.year,
        p_holidays: holidays as unknown as Json,
      },
    );

    if (error) {
      throw new Error(
        `${RpcFunctionName.ReplaceCountryHolidays} failed: ${error.message}`,
      );
    }

    return (data ?? []).map(this.mapToViewModel);
  }
}
