import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from 'src/common/repositories/base.repository';

export interface ITeamViewModel {
  id: string;
  name: string;
  createdAt: string | null;
}

@Injectable()
export class TeamsRepository extends BaseRepository<
  Tables['teams'],
  ITeamViewModel
> {
  protected tableName: TableName = 'teams';

  protected mapToViewModel = (row: Tables['teams']['Row']) => {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    };
  };
}
