import { Injectable } from '@nestjs/common';
import { IUserViewModel, UsersRepository } from 'src/users/users.repository';
import UserRole from 'src/enums/UserRole';

interface ICreateUserParams {
  email: string;
  name: string;
  role: UserRole;
  slack_id: string;
}

interface IUsersService {
  create(params: ICreateUserParams): Promise<IUserViewModel>;
}

@Injectable()
export class UsersService implements IUsersService {
  public constructor(private readonly userRepository: UsersRepository) {}

  public async create({
    email,
    name,
    role = UserRole.Employee,
    slack_id,
  }: ICreateUserParams) {
    return await this.userRepository.create({
      created_at: new Date().toISOString(),
      email,
      name,
      role,
      slack_id,
    });
  }
}
