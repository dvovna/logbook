import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamsRepository } from 'src/teams/teams.repository';

interface ICreateTeamParams {
  name: string;
  slackTeamId: string;
  isPrimary?: boolean;
}

export default class TeamsService {
  public constructor(private readonly teamsRepository: TeamsRepository) {}

  public create(createParams: ICreateTeamParams, user: IUserViewModel) {
    return this.teamsRepository.create({
      name: createParams.name,
      slack_team_id: createParams.slackTeamId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: user.id,
      updated_by: user.id,
      is_primary: createParams.isPrimary || false,
    });
  }

  public createDefaultTeam(slackTeamId: string) {
    return this.teamsRepository.create({
      name: 'Main Team',
      slack_team_id: slackTeamId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: null,
      updated_by: null,
      is_primary: true,
    });
  }
}
