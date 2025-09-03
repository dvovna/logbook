import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { ActionsBlock, AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ISearchResult } from 'src/common/types/pagination.types';
import capitalize from 'src/common/utils/capitalize';
import { IUsersTabViewFilters } from 'src/slack/services/users-tab.service';
import { ROLE_OPTIONS } from 'src/slack/constants/use-roles.constants';

export interface IUsersTabMetaData {
  filters?: IUsersTabViewFilters;
}

interface IGetViewParams {
  users: ISearchResult<IUserViewModel>;
  teams: ITeamViewModel[];
  userId: string;
}

const SHOW_INACTIVE_OPTION = {
  text: { type: 'plain_text', text: 'Inactive Only' },
  value: 'inactive_only',
};

const SHOW_ACTIVE_OPTION = {
  text: { type: 'plain_text', text: 'Active Users Only' },
  value: 'active_only',
};

export const ALL_OPTION_VALUE = 'all';

const ALL_ROLES_SELECT_OPTION = {
  text: { type: 'plain_text', text: 'All Roles' },
  value: ALL_OPTION_VALUE,
};

const ALL_TEAMS_SELECT_OPTION = {
  text: { type: 'plain_text', text: 'All Teams' },
  value: ALL_OPTION_VALUE,
};

export enum UsersTabViewActionId {
  BackToHomeTap = 'back_to_home_tab',
  UsersPaginationPrev = 'users_pagination_prev',
  UsersPaginationNext = 'users_pagination_next',
  ManageUserMenu = 'manage_user_menu',
  EditUser = 'edit_user',
  ChangeStatus = 'change_status',
  FilterUsersByRole = 'filter_users_by_role',
  FilterUsersByTeam = 'filter_users_by_team',
  FilterUsersByStatus = 'filter_users_by_status',
}

@Injectable()
export class UsersTabViewService {
  public getView(
    { userId, teams, users }: IGetViewParams,
    metadata: IUsersTabMetaData = {},
  ) {
    return {
      user_id: userId,
      view: {
        type: 'home',
        private_metadata: JSON.stringify(metadata),
        callback_id: ViewCallbackId.UsersTabView,
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
          action_id: UsersTabViewActionId.BackToHomeTap,
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
    const teamsById = teams.reduce(
      (acc, team) => {
        acc[team.id] = team;
        return acc;
      },
      {} as Record<string, ITeamViewModel>,
    );

    for (const user of users.items) {
      const team = teamsById[user.team_id];

      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text:
              `*${user.name}* (${user.email})\n` +
              `Role: ${user.role}\n` +
              `Team: ${team.name || '-'}\n` +
              `Carryover Days: ${user.carryover_days || '-'}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: UsersTabViewActionId.ManageUserMenu,
          options: [
            ...(user.is_active
              ? [
                {
                  text: { type: 'plain_text', text: 'Edit User' },
                  value: `${UsersTabViewActionId.EditUser}:${user.id}`,
                } as PlainTextOption,
              ]
              : []),
            {
              text: {
                type: 'plain_text',
                text: `${user.is_active ? 'Deactivate' : 'Activate'} User`,
              },
              value: `${UsersTabViewActionId.ChangeStatus}:${user.id}`,
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
          action_id: UsersTabViewActionId.FilterUsersByRole,
          initial_option: {
            text: {
              type: 'plain_text',
              text: filters?.selectedRole
                ? capitalize(filters.selectedRole)
                : 'All Roles',
            },
            value: filters?.selectedRole || ALL_OPTION_VALUE,
          },
          options: [ALL_ROLES_SELECT_OPTION, ...ROLE_OPTIONS],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Team' },
          action_id: UsersTabViewActionId.FilterUsersByTeam,
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
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Status' },
          action_id: UsersTabViewActionId.FilterUsersByStatus,
          initial_option:
            filters?.userStatus === 'inactive_only'
              ? SHOW_INACTIVE_OPTION
              : SHOW_ACTIVE_OPTION,
          options: [SHOW_ACTIVE_OPTION, SHOW_INACTIVE_OPTION],
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
          ? [
            {
              type: 'button',
              text: { type: 'plain_text', text: '⬅ Prev' },
              action_id: UsersTabViewActionId.UsersPaginationPrev,
              value: String(page - 1),
            },
          ]
          : []),
        ...(page < totalPages
          ? [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Next ➡' },
              action_id: UsersTabViewActionId.UsersPaginationNext,
              value: String(page + 1),
            },
          ]
          : []),
      ],
    } as ActionsBlock);

    return blocks as ActionsBlock[];
  }
}
