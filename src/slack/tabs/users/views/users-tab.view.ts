import { Injectable } from '@nestjs/common';
import { ActionsBlock, AnyBlock, PlainTextOption } from '@slack/web-api';
import ITeamViewModel from 'src/teams/types/team.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ISearchResult } from 'src/common/types/pagination.types';
import capitalize from 'src/common/utils/capitalize';
import { IUsersTabViewFilters } from 'src/slack/tabs/users/services/users-tab.service';
import { ROLE_OPTIONS } from 'src/slack/tabs/users/views/options/use-role.options';
import { ALL_OPTION_VALUE } from 'src/slack/common/views/data/all-option-value';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { PaginatedListView } from 'src/slack/common/views/components/paginated-list.view';
import { IBaseTabViewParams } from 'src/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { UsersTabViewActionId } from 'src/slack/tabs/users/enums/users-tab-view-action-id.enum';
import UserRole from 'src/common/enums/user-role.enum';

export interface IUsersTabMetaData {
  page?: number;
  filters?: IUsersTabViewFilters;
}

interface IGetViewParams extends IBaseTabViewParams {
  users: ISearchResult<IUserViewModel>;
  teams: ITeamViewModel[];
}

const SHOW_INACTIVE_OPTION = {
  text: { type: 'plain_text', text: 'Inactive Only' },
  value: 'inactive_only',
};

const SHOW_ACTIVE_OPTION = {
  text: { type: 'plain_text', text: 'Active Users Only' },
  value: 'active_only',
};

const ALL_ROLES_SELECT_OPTION = {
  text: { type: 'plain_text', text: 'All Roles' },
  value: ALL_OPTION_VALUE,
};

const ALL_TEAMS_SELECT_OPTION = {
  text: { type: 'plain_text', text: 'All Teams' },
  value: ALL_OPTION_VALUE,
};

@Injectable()
export class UsersTabView extends BaseAdminTabView<
  IGetViewParams,
  IUsersTabMetaData
> {
  protected activeTabActionId = AdminNavigationActionId.ManageUsers;
  protected callbackId = ViewCallbackId.UsersTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*👥 Users Management*\nList of employees with vacation balances and details.';
  }

  protected getContentBlocks(
    { users, teams, userRole },
    { filters },
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push(this.getFiltersBlock(teams, filters));

    const blocksToAdd = this.getUsersListBlocks(users, teams, userRole);

    blocks.push(...blocksToAdd);

    return blocks;
  }

  private getUsersListBlocks(
    usersData: ISearchResult<IUserViewModel>,
    teams: ITeamViewModel[],
    userRole: UserRole,
  ): AnyBlock[] {
    const teamsById = teams.reduce(
      (acc, team) => {
        acc[team.id] = team;
        return acc;
      },
      {} as Record<string, ITeamViewModel>,
    );

    return PaginatedListView.getBlocks<IUserViewModel>({
      itemsData: usersData,
      getItemBlocks: (item) =>
        this.getUserListItemBlocks(item, teamsById, userRole),
      prevPageActionId: UsersTabViewActionId.PaginationPrev,
      nextPageActionId: UsersTabViewActionId.PaginationNext,
      emptyText: '_No users found_',
    });
  }

  private getUserRowAccessory(
    user: IUserViewModel,
    userRole: UserRole,
  ): SectionBlockAccessory | undefined {
    return this.slackActionPermissionsService.can(
      userRole,
      UsersTabViewActionId.ManageUserMenu,
    )
      ? {
        type: 'overflow',
        action_id: UsersTabViewActionId.ManageUserMenu,
        options: [
          {
            text: { type: 'plain_text', text: 'View Vacation Usage' },
            value: `${UsersTabViewActionId.ViewVacationUsage}:${user.id}`,
          },
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
      }
      : undefined;
  }

  private getUserListItemBlocks(
    user: IUserViewModel,
    teamsById: Record<string, ITeamViewModel>,
    userRole: UserRole,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const team = user.team_id ? teamsById[user.team_id] : null;

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${user.name}* (${user.email})\n` +
            `Role: ${user.role}\n` +
            `Team: ${team?.name || '-'}\n` +
            `Carryover Days: ${user.carryover_days || '-'}`,
        },
      ],
      accessory: this.getUserRowAccessory(user, userRole),
    });

    blocks.push({ type: 'divider' });

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
          type: 'external_select',
          action_id: UsersTabViewActionId.FilterUsersByUser,
          placeholder: {
            type: 'plain_text',
            text: 'Filter by User',
          },
          min_query_length: 2,
          initial_option: filters?.user && {
            text: {
              type: 'plain_text',
              text: filters.user.name,
            },
            value: filters.user.value,
          },
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Role' },
          action_id: UsersTabViewActionId.FilterUsersByRole,
          initial_option: {
            text: {
              type: 'plain_text',
              text: filters?.role ? capitalize(filters.role) : 'All Roles',
            },
            value: filters?.role || ALL_OPTION_VALUE,
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
                teams.find((team) => team.id === filters?.teamId)?.name ||
                'All Teams',
            },
            value: filters?.teamId || ALL_OPTION_VALUE,
          },
          options: [ALL_TEAMS_SELECT_OPTION, ...teamOptions],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Status' },
          action_id: UsersTabViewActionId.FilterUsersByStatus,
          initial_option:
            filters?.status === 'inactive_only'
              ? SHOW_INACTIVE_OPTION
              : SHOW_ACTIVE_OPTION,
          options: [SHOW_ACTIVE_OPTION, SHOW_INACTIVE_OPTION],
        },
      ],
    } as ActionsBlock;
  }
}
