import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  Tables,
} from 'src/common/repositories/base.repository';
import UserRole from 'src/enums/UserRole';

export interface IUserViewModel {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  slack_id: string;
  created_at: string;
}

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
      slack_id: row.slack_id,
      created_at: row.created_at,
    };
  };
}
