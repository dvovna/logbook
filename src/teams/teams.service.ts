import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamsRepository } from 'src/teams/teams.repository';
import { Injectable, NotFoundException } from '@nestjs/common';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import { UsersService } from 'src/users/users.service';
import PrimaryEntityDeleteError from 'src/common/errors/primary-entity-delete.error';
import EntityHasDependenciesError from 'src/common/errors/entity-has-dependencies.error';

interface ICreateTeamParams {
  name: string;
  description?: string;
  vacationPolicyId: string;
  slackTeamId: string;
  isPrimary?: boolean;
}

interface IFindParams {
  id?: string;
  slackTeamId: string;
  vacationPolicyId?: string;
}

interface IUpdateParams {
  name?: string;
  description?: string;
  vacationPolicyId?: string;
}

const DEFAULT_TEAM_NAME = 'Main Team';
const MAX_TEAMS_COUNT = 5;

@Injectable()
export default class TeamsService {
  public constructor(
    private readonly teamsRepository: TeamsRepository,
    private readonly usersService: UsersService,
  ) {}

  public async findMany(params: IFindParams) {
    return this.teamsRepository.findMany(this.getFindQuery(params));
  }

  public async findOne(params: IFindParams) {
    return this.teamsRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(params: IFindParams) {
    const team = await this.teamsRepository.findOne(this.getFindQuery(params));

    if (!team) {
      throw new NotFoundException(`Team with id ${params.id} not found`);
    }

    return team;
  }

  public async create(createParams: ICreateTeamParams, user: IUserViewModel) {
    const teamsCount = await this.teamsRepository.count({
      slack_team_id: createParams.slackTeamId,
    });

    if (teamsCount >= MAX_TEAMS_COUNT) {
      throw new MaxItemsCountReachedError(MAX_TEAMS_COUNT, 'teams');
    }

    const createdAt = new Date().toISOString();

    return await this.teamsRepository.create({
      name: createParams.name,
      description: createParams.description || '',
      slack_team_id: createParams.slackTeamId,
      vacation_policy_id: createParams.vacationPolicyId,
      created_at: createdAt,
      updated_at: createdAt,
      created_by: user.id,
      updated_by: user.id,
      is_primary: createParams.isPrimary ?? false,
    });
  }

  public update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ) {
    return this.teamsRepository.update(this.getFindQuery(findParams), {
      ...(updateParams.name ? { name: updateParams.name } : {}),
      ...(updateParams.description
        ? { description: updateParams.description }
        : {}),
      ...(updateParams.vacationPolicyId
        ? { vacation_policy_id: updateParams.vacationPolicyId }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
  }

  public async delete(teamId: string, user: IUserViewModel) {
    const team = await this.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    if (team.is_primary) {
      throw new PrimaryEntityDeleteError('team');
    }

    const teamUsersCount = await this.usersService.count({
      teamId,
      slackTeamId: team.slack_team_id,
      isActive: true,
    });

    if (teamUsersCount > 0) {
      throw new EntityHasDependenciesError('team', 'users');
    }

    await this.teamsRepository.deleteMany({
      id: teamId,
      slack_team_id: user.slack_team_id,
    });

    return team;
  }

  public count(params: IFindParams) {
    return this.teamsRepository.count(this.getFindQuery(params));
  }

  private getFindQuery(params: IFindParams) {
    return {
      ...(params.id ? { id: params.id } : {}),
      slack_team_id: params.slackTeamId,
      ...(params.vacationPolicyId
        ? { vacation_policy_id: params.vacationPolicyId }
        : {}),
    };
  }

  public createDefaultTeam(slackTeamId: string, vacationPolicyId: string) {
    const createdAt = new Date().toISOString();

    return this.teamsRepository.create({
      name: DEFAULT_TEAM_NAME,
      description: '',
      slack_team_id: slackTeamId,
      vacation_policy_id: vacationPolicyId,
      created_at: createdAt,
      updated_at: createdAt,
      created_by: null,
      updated_by: null,
      is_primary: true,
    });
  }
}
