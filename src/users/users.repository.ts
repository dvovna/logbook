import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  Tables,
} from 'src/common/repositories/base.repository';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
export class UsersRepository extends BaseRepository<
  Tables['users'],
  IUserViewModel
> {
  protected readonly tableName = 'users';

  protected mapToViewModel = (row: Tables['users']['Row']) => {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as UserRole,
      contract_start_date: row.contract_start_date,
      slack_id: row.slack_id,
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      created_at: row.created_at,
    };
  };
}
