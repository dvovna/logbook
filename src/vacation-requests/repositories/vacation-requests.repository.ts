import { Injectable } from '@nestjs/common';
import {
  ISqlRelation,
  SqlRepository,
} from '@common/repositories/sql.repository';
import { SqlInsert, SqlRow } from '@common/types/sql-database.types';
import { callFunction } from 'src/database/sql-functions';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

@Injectable()
export class VacationRequestsRepository extends SqlRepository<
  'vacation_requests',
  IVacationRequestViewModel
> {
  protected readonly tableName = 'vacation_requests';

  protected relations: Record<string, ISqlRelation> = {
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

  // In one transaction (replace_user_vacations): the user's vacations are
  // replaced by `vacations`, or nothing changes.
  public async replaceUserVacations(
    slackTeamId: string,
    userId: string,
    vacations: Omit<
      SqlInsert<'vacation_requests'>,
      'slack_team_id' | 'user_id'
    >[],
  ): Promise<IVacationRequestViewModel[]> {
    const rows = await callFunction(this.db, 'replace_user_vacations', {
      p_slack_team_id: slackTeamId,
      p_user_id: userId,
      p_vacations: JSON.stringify(vacations),
    });

    // The function returns bare rows, without the user and the team.
    return rows.map((row) =>
      this.mapToViewModel({
        ...row,
        user: null,
        team: null,
      } as SqlRow<'vacation_requests'>),
    );
  }
}
