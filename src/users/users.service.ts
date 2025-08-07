import { Injectable } from '@nestjs/common';
import { UsersRepository } from 'src/users/users.repository';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

interface ICreateUserParams {
  email: string;
  name: string;
  role: UserRole;
  teamId: string;
  slackId: string;
  contractStartDate?: string;
}

interface IFindParams {
  id?: string;
  slackId?: string;
  teamId?: string;
  email?: string;
}

interface IUsersService {
  create(params: ICreateUserParams): Promise<IUserViewModel>;
  findOne(params: IFindParams): Promise<IUserViewModel | null>;
}

@Injectable()
export class UsersService implements IUsersService {
  public constructor(private readonly userRepository: UsersRepository) {}

  public async create({
    email,
    name,
    role = UserRole.Member,
    slackId,
    teamId,
  }: ICreateUserParams) {
    return await this.userRepository.create({
      created_at: new Date().toISOString(),
      email,
      name,
      team_id: teamId,
      role,
      slack_id: slackId,
    });
  }

  public async update(
    id: string,
    params: Partial<ICreateUserParams>,
  ): Promise<IUserViewModel | null> {
    return await this.userRepository.update(
      {
        id,
      },
      {
        ...params,
      },
    );
  }

  public async bulkCreate(paramsList: ICreateUserParams[]) {
    const users = paramsList.map(
      ({ email, name, role, teamId, slackId, contractStartDate }) => ({
        email,
        name,
        role: role || UserRole.Member,
        team_id: teamId,
        slack_id: slackId,
        contract_start_date: contractStartDate || null,
        created_at: new Date().toISOString(),
      }),
    );

    return await this.userRepository.createMany(users);
  }

  public async findOne(
    findParams: IFindParams,
  ): Promise<IUserViewModel | null> {
    return await this.userRepository.findOne({
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slackId ? { slack_id: findParams.slackId } : {}),
      ...(findParams.teamId ? { team_id: findParams.teamId } : {}),
      ...(findParams.email ? { email: findParams.email } : {}),
    });
  }

  public async findOneWithValidation(
    findParams: IFindParams,
  ): Promise<IUserViewModel> {
    const user = await this.findOne(findParams);

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }
}
