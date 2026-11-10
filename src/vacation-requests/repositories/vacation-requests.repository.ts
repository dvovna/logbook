import { Injectable } from '@nestjs/common';
import {
  IRelation,
  BaseRepository,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

@Injectable()
export class VacationRequestsRepository extends BaseRepository<
  'vacation_requests',
  IVacationRequestViewModel
> {
  protected readonly tableName = 'vacation_requests';

  protected relations: Record<string, IRelation> = {
    user: {
      table: 'users',
      foreignKey: 'user_id',
      columns: ['id', 'name', 'email', 'slack_id'],
    },
    team: { table: 'teams', foreignKey: 'team_id', columns: ['id', 'name'] },
  };

  protected mapToViewModel = (row: SqlRow<'vacation_requests'>) => {
    const extendedRow = row as SqlRow<'vacation_requests'> & {
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
}
