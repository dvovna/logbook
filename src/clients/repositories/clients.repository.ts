import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import IClientViewModel from '@modules/clients/types/client.interface';

@Injectable()
export class ClientsRepository extends BaseRepository<
  Tables['clients'],
  IClientViewModel
> {
  protected tableName: TableName = 'clients';

  protected mapToViewModel = (
    row: Tables['clients']['Row'],
  ) => {
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
