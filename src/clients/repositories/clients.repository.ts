import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
import IClientViewModel from '@modules/clients/types/client.interface';

@Injectable()
export class ClientsRepository extends SqlRepository<
  'clients',
  IClientViewModel
> {
  protected readonly tableName = 'clients';

  // One statement: the client is gone and returned, or null when the
  // workspace has no client with that ID.
  public async deleteOne(
    id: string,
    slackTeamId: string,
  ): Promise<IClientViewModel | null> {
    const row = await this.deleteInWorkspace(slackTeamId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return row ? this.mapToViewModel(row) : null;
  }

  protected mapToViewModel = (row: SqlRow<'clients'>) => {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      slack_team_id: row.slack_team_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      archived_at: row.archived_at,
      archived_by: row.archived_by,
    };
  };
}
