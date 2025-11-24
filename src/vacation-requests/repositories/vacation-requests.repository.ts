import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  Tables,
} from '@common/repositories/base.repository';
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
}
