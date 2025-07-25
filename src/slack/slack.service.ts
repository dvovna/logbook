import { Injectable } from '@nestjs/common';
import SlackApiClient from 'src/clients/third-party/slack-api.client';
import { UsersRepository } from 'src/users/users.repository';
import { TeamsRepository } from 'src/teams/teams.repository';

@Injectable()
export class SlackService {
  public constructor(
    private readonly teamsRepo: TeamsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly slackApiClient: SlackApiClient,
  ) {}

  public async exchangeCodeAndCreateTeam(code: string): Promise<void> {
    const data = await this.slackApiClient.exchangeCode(code);

    const teamId = data.team.id;
    const teamName = data.team.name;
    const slackUserId = data.authed_user.id;
    const accessToken = data.access_token;

    await this.teamsRepo.create({
      id: teamId,
      name: teamName,
      slack_token: accessToken,
    });

    await this.usersRepo.create({
      slack_id: slackUserId,
      team_id: teamId,
      name: 'Admin User',
      email: null,
      role: 'admin',
      created_at: new Date().toISOString(),
    });
  }
}
