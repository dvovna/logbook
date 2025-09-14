import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { VacationPoliciesCacheService } from 'src/vacation-policies/services/vacation-policies-cache.service';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';

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
}

@Injectable()
export class TeamsTabView extends BaseAdminTabView<IGetViewParams, never> {
  protected callbackId = ViewCallbackId.TeamsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageTeams;

  public constructor(
    private readonly vacationPoliciesCacheService: VacationPoliciesCacheService,
  ) {
    super();
  }

  protected getTabTitle() {
    return '🏢 Teams Management';
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Team' },
      action_id: TeamsTabViewActionId.AddTeam,
    };
  }

  protected async getContentBlocks({
    teams,
    usersCountByTeam,
  }): Promise<AnyBlock[]> {
    const blocks: AnyBlock[] = [];

    const blocksToAdd = await this.getTeamsListBlocks(teams, usersCountByTeam);

    blocks.push(...blocksToAdd);

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
