import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { VacationPoliciesCacheService } from 'src/vacation-policies/services/vacation-policies-cache.service';

interface IGetViewParams {
  teams: ITeamViewModel[];
  usersCountByTeam: Record<string, number>;
  userId: string;
}

@Injectable()
export class TeamsManagementTabViewService {
  public constructor(
    private readonly vacationPoliciesCacheService: VacationPoliciesCacheService,
  ) {}

  public async getView({ userId, teams, usersCountByTeam }: IGetViewParams) {
    return {
      user_id: userId,
      view: {
        type: 'home',
        callback_id: ViewCallbackId.TeamsManagement,
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
          action_id: ViewActionId.AddTeam,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '⬅ Back' },
          action_id: ViewActionId.BackToHomeTap,
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
          action_id: ViewActionId.ManageTeamMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit Team' },
              value: `edit_team:${team.id}`,
            },
            {
              text: {
                type: 'plain_text',
                text: 'Delete Team',
              },
              value: `delete_team:${team.id}`,
            },
          ],
        },
      });

      blocks.push({ type: 'divider' });
    }

    return blocks;
  }
}
