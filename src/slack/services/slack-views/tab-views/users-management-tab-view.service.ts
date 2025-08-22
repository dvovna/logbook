import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { ActionsBlock, AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ISearchResult } from 'src/common/types/pagination.types';
import UserRole from 'src/common/enums/user-role.enum';
import capitalize from 'src/common/utils/capitalize';
import { IUsersTabViewFilters } from 'src/slack/services/users-tab.service';

export interface IUsersTabMetaData {
  filters?: IUsersTabViewFilters;
}

interface IGetViewParams {
  users: ISearchResult<IUserViewModel>;
  teams: ITeamViewModel[];
  userId: string;
}

export const ALL_OPTION_VALUE = 'all';

const ALL_ROLES_SELECT_OPTION = {
  text: { type: 'plain_text', text: 'All Roles' },
  value: ALL_OPTION_VALUE,
};

const ALL_TEAMS_SELECT_OPTION = {
  text: { type: 'plain_text', text: 'All Teams' },
  value: ALL_OPTION_VALUE,
};

@Injectable()
export class UsersManagementTabViewService {
  public getView(
    { userId, teams, users }: IGetViewParams,
    metadata: IUsersTabMetaData = {},
  ) {
    return {
      user_id: userId,
      private_metadata: JSON.stringify(metadata),
      view: {
        type: 'home',
        callback_id: ViewCallbackId.UsersManagement,
        blocks: this.getViewBlocks(users, teams, metadata.filters),
      },
    } as ViewsPublishArguments;
  }

  private getViewBlocks(
    users: ISearchResult<IUserViewModel>,
    teams: ITeamViewModel[],
    filters?: IUsersTabViewFilters,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*👥 Users Management*' },
    });

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `Users Total Count: ${users.totalCount}` },
    });

    blocks.push(this.getFiltersBlock(teams, filters));

    const blocksToAdd = this.getUsersListBlocks(users, teams);

    blocks.push(...blocksToAdd);

    const totalPages = Math.ceil(users.totalCount / users.pageSize);

    if (totalPages > 1) {
      blocks.push(...this.getPaginationBlocks(users.page, totalPages));
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Back To Home Page' },
          action_id: ViewActionId.BackToHomeTap,
        },
      ],
    });

    return blocks;
  }

  private getUsersListBlocks(
    users: ISearchResult<IUserViewModel>,
    teams: ITeamViewModel[],
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    for (const user of users.items) {
      const team = teams.find((t) => t.id === user.team_id);
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text:
              `*${user.name}* (${user.email})\n` +
              `Role: ${user.role}\n` +
              `Team: ${team?.name || '-'}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: ViewActionId.ManageUserMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Change Role' },
              value: `change_role:${user.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Change Team' },
              value: `change_team:${user.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Deactivate User' },
              value: `deactivate_user:${user.id}`,
            },
          ],
        },
      });

      blocks.push({ type: 'divider' });
    }

    if (users.items.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No users found_' },
      });
    }

    return blocks;
  }

  private getFiltersBlock(
    teams: ITeamViewModel[],
    filters?: IUsersTabViewFilters,
  ): ActionsBlock {
    const roleOptions = Object.values(UserRole).map((role) => ({
      text: { type: 'plain_text', text: capitalize(role) },
      value: role,
    }));

    const teamOptions = teams.map((team) => ({
      text: { type: 'plain_text', text: team.name },
      value: team.id,
    }));

    return {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Role' },
          action_id: ViewActionId.FilterUsersByRole,
          initial_option: {
            text: {
              type: 'plain_text',
              text: filters?.selectedRole
                ? capitalize(filters.selectedRole)
                : 'All Roles',
            },
            value: filters?.selectedRole || ALL_OPTION_VALUE,
          },
          options: [ALL_ROLES_SELECT_OPTION, ...roleOptions],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Team' },
          action_id: ViewActionId.FilterUsersByTeam,
          initial_option: {
            text: {
              type: 'plain_text',
              text:
                teams.find((team) => team.id === filters?.selectedTeamId)
                  ?.name || 'All Teams',
            },
            value: filters?.selectedTeamId || ALL_OPTION_VALUE,
          },
          options: [ALL_TEAMS_SELECT_OPTION, ...teamOptions],
        },
      ],
    } as ActionsBlock;
  }

  private getPaginationBlocks(
    page: number,
    totalPages: number,
  ): ActionsBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Page ${page} of ${totalPages}*`,
      },
    });

    blocks.push({
      type: 'actions',
      elements: [
        ...(page > 1
          ? [{
            type: 'button',
            text: { type: 'plain_text', text: '⬅ Prev' },
            action_id: ViewActionId.UsersPaginationPrev,
            value: String(page - 1),
          }]
          : []),
        ...(page < totalPages
          ? [{
            type: 'button',
            text: { type: 'plain_text', text: 'Next ➡' },
            action_id: ViewActionId.UsersPaginationNext,
            value: String(page + 1),
          }]
          : []),
      ],
    } as ActionsBlock);

    return blocks as ActionsBlock[];
  }
}
