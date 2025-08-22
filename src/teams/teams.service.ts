import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamsRepository } from 'src/teams/teams.repository';
import { Injectable } from '@nestjs/common';
import MaxTeamsCountReachedError from 'src/common/errors/max-teams-count-reached.error';
import { UsersService } from 'src/users/users.service';
import TeamDeleteError from 'src/common/errors/team-delete.error';

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

  public async findMany({ slackTeamId }: IFindParams) {
    return this.teamsRepository.findMany({ slack_team_id: slackTeamId });
  }

  public async findOne(params: IFindParams) {
    return this.teamsRepository.findOne({
      slack_team_id: params.slackTeamId,
      id: params.id,
    });
  }

  public async create(createParams: ICreateTeamParams, user: IUserViewModel) {
    const teamsCount = await this.teamsRepository.count({
      slack_team_id: createParams.slackTeamId,
    });

    if (teamsCount >= MAX_TEAMS_COUNT) {
      throw new MaxTeamsCountReachedError(MAX_TEAMS_COUNT);
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
    return this.teamsRepository.update(
      {
        slack_team_id: findParams.slackTeamId,
        id: findParams.id,
      },
      {
        ...(updateParams.name ? { name: updateParams.name } : {}),
        ...(updateParams.description
          ? { description: updateParams.description }
          : {}),
        ...(updateParams.vacationPolicyId
          ? { vacation_policy_id: updateParams.vacationPolicyId }
          : {}),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
    );
  }

  public async delete(teamId: string) {
    const team = await this.teamsRepository.findOne({ id: teamId });

    if (!team) {
      throw new Error(`Team with id ${teamId} not found`);
    }

    if (team?.is_primary) {
      throw new TeamDeleteError('Primary team cannot be deleted');
    }

    const teamUsersCount = await this.usersService.count({
      teamId,
      slackTeamId: team?.slack_team_id,
      isActive: true,
    });

    if (teamUsersCount > 0) {
      throw new TeamDeleteError('Cannot delete team with users assigned');
    }

    await this.teamsRepository.delete({ id: teamId });

    return team;
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
