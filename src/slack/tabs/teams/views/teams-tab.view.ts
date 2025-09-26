import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from 'src/slack/common/views/components/paginated-list.view';
import { ISearchResult } from 'src/common/types/pagination.types';
import { IBaseTabViewParams } from 'src/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';

interface IGetViewParams extends IBaseTabViewParams {
  teamsData: ISearchResult<ITeamViewModel>;
  usersCountByTeam: Record<string, number>;
}

export interface ITeamsTabMetaData {
  page?: number;
}

export enum TeamsTabViewActionId {
  AddTeam = 'add_team',
  EditTeam = 'edit_team',
  DeleteTeam = 'delete_team',
  ManageTeamMenu = 'manage_team_menu',
  PaginationPrev = 'teams_pagination_prev',
  PaginationNext = 'teams_pagination_next',
}

@Injectable()
export class TeamsTabView extends BaseAdminTabView<
  IGetViewParams,
  ITeamsTabMetaData
> {
  protected callbackId = ViewCallbackId.TeamsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageTeams;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '🏢 *Teams Management*\nManage team membership, assign vacation policies, \nand configure approvers/notification recipients.';
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Team' },
      action_id: TeamsTabViewActionId.AddTeam,
    };
  }

  protected getContentBlocks({ teamsData, usersCountByTeam }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const listBlocks = PaginatedListView.getBlocks<ITeamViewModel>({
      itemsData: teamsData,
      getItemBlocks: (item: ITeamViewModel) =>
        this.getTeamListItemBlocks(item, usersCountByTeam),
      prevPageActionId: TeamsTabViewActionId.PaginationPrev,
      nextPageActionId: TeamsTabViewActionId.PaginationNext,
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getTeamListItemBlocks(
    team: ITeamViewModel,
    usersCountByTeam: Record<string, number>,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const isPrimary = team.is_primary ? '⭐️' : '';
    const updatedAt = new Date(team.updated_at).toLocaleDateString();
    const createdAt = new Date(team.created_at).toLocaleDateString();
    const teamUsersCount = usersCountByTeam[team.id] || 0;

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${team.name}*${isPrimary}\n` +
            `Vacation Policy: ${team.vacation_policy?.name || '-'}\n` +
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

    return blocks;
  }
}
