import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { ISearchResult } from '@common/types/pagination.types';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';

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
  protected activeTabActionId = AdminNavigationActionId.ManagePeople;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '🏢 *Teams Management*\n\nManage team membership, assign vacation policies, \nand configure approvers/notification recipients.';
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Team' },
      action_id: TeamsTabViewActionId.AddTeam,
    };
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManagePeople);
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

    const updatedAt = new Date(team.updated_at).toLocaleDateString();
    const createdAt = new Date(team.created_at).toLocaleDateString();
    const teamUsersCount = usersCountByTeam[team.id] || 0;

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${team.name}*\n` +
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

    blocks.push(...SeparatorComponent.getBlocks());

    return blocks;
  }
}
