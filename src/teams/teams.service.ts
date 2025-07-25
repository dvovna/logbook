import { Injectable } from '@nestjs/common';
import { TeamsRepository } from 'src/teams/teams.repository';

interface ICreateTeamParams {
  name: string;
  slack_id: string;
  slack_token: string;
}

interface IFindParams {
  id?: string;
  slack_id?: string;
}

@Injectable()
export class TeamsService {
  public constructor(private readonly teamsRepository: TeamsRepository) {}

  public async create({ name, slack_id, slack_token }: ICreateTeamParams) {
    return await this.teamsRepository.create({
      slack_id,
      name,
      slack_token,
      created_at: new Date().toISOString(),
    });
  }

  public async findOne(findParams: IFindParams) {
    return await this.teamsRepository.findOne({
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slack_id ? { slack_id: findParams.slack_id } : {}),
    });
  }

  public async delete(teamId: string) {
    return await this.teamsRepository.delete({ id: teamId });
  }
}
