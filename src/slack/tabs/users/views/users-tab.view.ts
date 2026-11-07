import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISearchResult } from '@common/types/pagination.types';
import { IUsersTabViewFilters } from '@modules/slack/tabs/users/services/users-tab.service';
import {
  ROLE_DISPLAY_NAME,
  ROLE_OPTIONS,
} from '@modules/slack/tabs/users/views/options/use-role.options';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import UserRole from '@common/enums/user-role.enum';
import { Divider } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

export interface IUsersTabMetaData {
  page?: number;
  filters?: IUsersTabViewFilters;
  includeInactive?: boolean;
}

interface IGetViewParams extends IBaseTabViewParams {
  users: ISearchResult<IUserViewModel>;
  teams: ITeamViewModel[];
}

const INACTIVE_PLAIN_TEXT_OPTIONS: PlainTextOption[] = [
  toPlainTextOption({
    name: 'Include inactive users',
    id: YesNoValue.Yes,
  }),
];

@Injectable()
export class UsersTabView extends BaseAdminTabView<
  IGetViewParams,
  IUsersTabMetaData
> {
  protected activeTabActionId = AdminNavigationActionId.ManagePeople;
  protected callbackId = ViewCallbackId.UsersTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*👥 Users Management*';
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManagePeople);
  }

  protected getContentBlocks(
    { users, teams, userRole },
    { filters, includeInactive },
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      {
        type: 'section',
        text: {
          type: 'plain_text',
          text: 'List of employees with vacation balances and details.',
        },
      },
    ];

    blocks.push(...this.getFiltersBlocks(teams, filters));
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'checkboxes',
          action_id: UsersTabViewActionId.IncludeInactive,
          options: INACTIVE_PLAIN_TEXT_OPTIONS,
          initial_options: includeInactive
            ? INACTIVE_PLAIN_TEXT_OPTIONS
            : undefined,
        },
      ],
    });

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

  // The menu items the role allows; an inactive user can only be activated.
  private getUserRowAccessory(
    user: IUserViewModel,
    userRole: UserRole,
  ): SectionBlockAccessory | undefined {
    const items = [
      ...(user.is_active
        ? [
            { id: UsersTabViewActionId.EditUser, name: 'Edit User' },
            {
              id: UsersTabViewActionId.ViewVacationUsage,
              name: 'View Vacation Usage',
            },
          ]
        : []),
      {
        id: UsersTabViewActionId.ChangeStatus,
        name: `${user.is_active ? 'Deactivate' : 'Activate'} User`,
      },
    ].filter(({ id }) => this.slackActionPermissionsService.can(userRole, id));

    if (
      !items.length ||
      !this.slackActionPermissionsService.can(
        userRole,
        UsersTabViewActionId.ManageUserMenu,
      )
    ) {
      return undefined;
    }

    return {
      type: 'overflow',
      action_id: UsersTabViewActionId.ManageUserMenu,
      options: items.map(
        ({ id, name }) =>
          ({
            text: { type: 'plain_text', text: name },
            value: `${id}:${user.id}`,
          }) as PlainTextOption,
      ),
    };
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
            `*${escapeMrkdwn(user.name)}* (${escapeMrkdwn(user.email)})\n` +
            `Role: ${ROLE_DISPLAY_NAME[user.role]}\n` +
            `Team: ${team?.name || '-'}\n` +
            `Contract Start Date: ${user.contract_start_date || '-'}\n` +
            `Carryover Days: ${user.carryover_days || '-'}`,
        },
      ],
      accessory: this.getUserRowAccessory(user, userRole),
    });

    blocks.push(...Divider.getBlocks());

    return blocks;
  }

  private getFiltersBlocks(
    teams: ITeamViewModel[],
    filters?: IUsersTabViewFilters,
  ) {
    const userFilters: IFiltersConfig[] = [
      {
        type: 'external_select',
        actionId: UsersTabViewActionId.FilterUsersByUser,
        placeholder: 'Filter by User',
        minQueryLength: 2,
        initialOption: filters?.user,
      },
      {
        type: 'static_select',
        actionId: UsersTabViewActionId.FilterUsersByRole,
        placeholder: 'Filter by Role',
        options: ROLE_OPTIONS,
        initialValue: filters?.role,
      },
      {
        type: 'static_select',
        actionId: UsersTabViewActionId.FilterUsersByTeam,
        placeholder: 'Filter by Team',
        options: teams,
        initialValue: filters?.teamId,
      },
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: userFilters,
      resetButtonActionId: UsersTabViewActionId.ResetFilters,
      separator: false,
    });
  }
}
