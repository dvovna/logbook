import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
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
      leave_file_upload_id: extendedRow.leave_file_upload_id,
      awaits_approvers: extendedRow.awaits_approvers,
    };
  };

  // How many requests each person of the workspace has, of any status.
  public async countByUser(slackTeamId: string): Promise<Map<string, number>> {
    const rows = await this.selectInWorkspace(slackTeamId)
      .select((eb) => ['user_id', eb.fn.countAll<number>().as('count')])
      .groupBy('user_id')
      .execute();

    return new Map(rows.map(({ user_id, count }) => [user_id, Number(count)]));
  }

  // Deletes each request, in one statement, only while it is as its upload
  // left it. Returns the IDs it deleted.
  public async deleteUnchanged(
    slackTeamId: string,
    uploadId: string,
    requests: { id: string; updatedAt: string }[],
  ): Promise<string[]> {
    if (!requests.length) {
      return [];
    }

    const rows = await this.deleteInWorkspace(slackTeamId)
      .using(
        sql<{ id: string; updated_at: string }>`(
          select * from jsonb_to_recordset(${JSON.stringify(
            requests.map(({ id, updatedAt }) => ({
              id,
              updated_at: updatedAt,
            })),
          )}::jsonb) as unchanged (id uuid, updated_at timestamptz)
        )`.as('unchanged'),
      )
      .whereRef('vacation_requests.id', '=', 'unchanged.id')
      .whereRef('vacation_requests.updated_at', '=', 'unchanged.updated_at')
      .where('vacation_requests.leave_file_upload_id', '=', uploadId)
      .returning('vacation_requests.id')
      .execute();

    return rows.map(({ id }) => id);
  }
}
