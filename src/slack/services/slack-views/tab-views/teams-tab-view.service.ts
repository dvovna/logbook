import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { VacationPoliciesCacheService } from 'src/vacation-policies/services/vacation-policies-cache.service';

interface IGetViewParams {
  teams: ITeamViewModel[];
  usersCountByTeam: Record<string, number>;
  userId: string;
}

export enum TeamsTabViewActionId {
  AddTeam = 'add_team',
  EditTeam = 'edit_team',
  DeleteTeam = 'delete_team',
  ManageTeamMenu = 'manage_team_menu',
  BackToHomeTap = 'back_to_home_tab',
}

@Injectable()
export class TeamsTabViewService {
  public constructor(
    private readonly vacationPoliciesCacheService: VacationPoliciesCacheService,
  ) {}

  public async getView({ userId, teams, usersCountByTeam }: IGetViewParams) {
    return {
      user_id: userId,
      view: {
        type: 'home',
        callback_id: ViewCallbackId.TeamsTabView,
        blocks: await this.getViewBlocks(teams, usersCountByTeam),
      },
    } as ViewsPublishArguments;
  }

  private async getViewBlocks(
    teams: ITeamViewModel[],
    usersCountByTeam: Record<string, number>,
  ): Promise<AnyBlock[]> {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*🏢 Teams Management*' },
    });

    const blocksToAdd = await this.getTeamsListBlocks(teams, usersCountByTeam);

    blocks.push(...blocksToAdd);

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '➕ Add Team' },
          action_id: TeamsTabViewActionId.AddTeam,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Back To Home Page' },
          action_id: TeamsTabViewActionId.BackToHomeTap,
        },
      ],
    });

    return blocks;
  }

  private async getTeamsListBlocks(
    teams: ITeamViewModel[],
    usersCountByTeam: Record<string, number>,
  ): Promise<AnyBlock[]> {
    const blocks: AnyBlock[] = [];

    for (const team of teams) {
      const isPrimary = team.is_primary ? '⭐️' : '';
      const updatedAt = new Date(team.updated_at).toLocaleDateString();
      const createdAt = new Date(team.created_at).toLocaleDateString();
      const teamUsersCount = usersCountByTeam[team.id] || 0;
      const policy = await this.vacationPoliciesCacheService.getById(
        team.vacation_policy_id,
      );

      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text:
              `*${team.name}*${isPrimary}\n` +
              `Vacation Policy: ${policy?.name || '-'}\n` +
              `Description: ${team.description || '-'}\n` +
              `Users Count: ${teamUsersCount}\n` +
              `Created: ${createdAt}\n` +
              `Updated: ${updatedAt}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: TeamsTabViewActionId.ManageTeamMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit Team' },
              value: `${TeamsTabViewActionId.EditTeam}:${team.id}`,
            },
            {
              text: {
                type: 'plain_text',
                text: 'Delete Team',
              },
              value: `${TeamsTabViewActionId.DeleteTeam}:${team.id}`,
            },
          ],
        },
      });

      blocks.push({ type: 'divider' });
    }

    return blocks;
  }
}
