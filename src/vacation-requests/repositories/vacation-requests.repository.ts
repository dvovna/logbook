import { Json } from '@common/types/database.types';
import { RpcFunctionName } from '@common/enums/rpc-function-name';
import { Injectable } from '@nestjs/common';
import { BaseRepository, Tables } from '@common/repositories/base.repository';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

@Injectable()
export class VacationRequestsRepository extends BaseRepository<
  Tables['vacation_requests'],
  IVacationRequestViewModel
> {
  protected readonly tableName = 'vacation_requests';

  protected relations = {
    user: 'user_id ( id, name, email, slack_id )',
    team: 'team_id ( id, name )',
  };

  protected mapToViewModel = (row: Tables['vacation_requests']['Row']) => {
    const extendedRow = row as Tables['vacation_requests']['Row'] & {
      user: {
        id: string;
        name: string;
        email: string;
        slack_id: string;
      } | null;
      team: { id: string; name: string; slack_id: string } | null;
    };

    return {
      id: extendedRow.id,
      start_date: extendedRow.start_date,
      end_date: extendedRow.end_date,
      type: extendedRow.type as VacationType,
      status: extendedRow.status as VacationRequestStatus,
      days: extendedRow.days,
      working_days: extendedRow.working_days,
      user_comment: extendedRow.user_comment || null,
      rejection_reason: extendedRow.rejection_reason || null,
      user_id: extendedRow.user_id,
      team_id: extendedRow.team_id,
      slack_team_id: extendedRow.slack_team_id,
      user: extendedRow.user,
      team: extendedRow.team,
      created_at: extendedRow.created_at,
      updated_at: extendedRow.updated_at,
      updated_by: extendedRow.updated_by,
      created_by: extendedRow.created_by,
    };
  };

  // In one transaction (replace_user_vacations): the user's vacations are
  // replaced by `vacations`, or nothing changes.
  public async replaceUserVacations(
    slackTeamId: string,
    userId: string,
    vacations: Omit<
      Tables['vacation_requests']['Insert'],
      'slack_team_id' | 'user_id'
    >[],
  ): Promise<IVacationRequestViewModel[]> {
    const { data, error } = await this.client.rpc(
      RpcFunctionName.ReplaceUserVacations,
      {
        p_slack_team_id: slackTeamId,
        p_user_id: userId,
        p_vacations: vacations as unknown as Json,
      },
    );

    if (error) {
      throw new Error(
        `${RpcFunctionName.ReplaceUserVacations} failed: ${error.message}`,
      );
    }

    return (data ?? []).map(this.mapToViewModel);
  }
}
