import { Injectable } from '@nestjs/common';
import { SlackTeamsRepository } from 'src/slack-teams/slack-teams.repository';
import { SupabaseFilter } from 'src/common/repositories/base.repository';

interface ICreateTeamParams {
  name: string;
  slack_id: string;
  slack_token: string;
}

interface IFindParams {
  id?: string;
  slackId?: string;
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
    return await this.slackTeamsRepository.findOne(
      this.getFilterQuery(findParams),
    );
  }

  public async delete(findParams: IFindParams) {
    return await this.slackTeamsRepository.deleteMany(
      this.getFilterQuery(findParams),
    );
  }

  private getFilterQuery(findParams: IFindParams): SupabaseFilter {
    return {
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slackId ? { slack_id: findParams.slackId } : {}),
    };
  }
}
