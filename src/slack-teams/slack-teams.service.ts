import { Injectable } from '@nestjs/common';
import { SlackTeamsRepository } from 'src/slack-teams/slack-teams.repository';

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
export class SlackTeamsService {
  public constructor(
    private readonly slackTeamsRepository: SlackTeamsRepository,
  ) {}

  public async create({ name, slack_id, slack_token }: ICreateTeamParams) {
    return await this.slackTeamsRepository.create({
      slack_id,
      name,
      slack_token,
      created_at: new Date().toISOString(),
    });
  }

  public async findOne(findParams: IFindParams) {
    return await this.slackTeamsRepository.findOne({
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slack_id ? { slack_id: findParams.slack_id } : {}),
    });
  }

  public async delete(teamId: string) {
    return await this.slackTeamsRepository.deleteMany({ id: teamId });
  }
}
