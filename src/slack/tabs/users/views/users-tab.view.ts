import {
  getCurrentVacationPeriod,
  getJoinedVacationPeriod,
} from '@modules/vacation-requests/utils/vacation-period.utils';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { formatDate } from '@common/utils/date.utils';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { IOption } from '@common/types/option.interface';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISearchResult } from '@common/types/pagination.types';
import {
  ROLE_DISPLAY_NAME,
  ROLE_OPTIONS,
} from '@modules/slack/tabs/users/views/options/use-role.options';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import UserRole from '@common/enums/user-role.enum';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

export interface IUsersTabViewFilters {
  teamId?: string;
  role?: UserRole;
  user?: IOption;
}

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
export class UsersTabView extends BaseTabView<
  IGetViewParams,
  IUsersTabMetaData
> {
  protected callbackId = ViewCallbackId.UsersTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected getTabTitle(): string {
    return `*${SCREENS[ScreenId.People].title}*`;
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
          text: "Everyone in the workspace, with their role and team. ⋯ → View Vacation Usage shows someone's balance.",
        },
      },
    ];

    // CSV imports are for admins (FileUploadService refuses anyone else).
    if (userRole === UserRole.Admin) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📥 Import vacations (CSV)' },
            action_id: UsersTabViewActionId.ImportVacations,
          },
        ],
      });
    }

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

    blocks.push(
      ...ListItem.getBlocks({
        title: user.name,
        details: [
          [
            escapeMrkdwn(user.email),
            `Role: ${ROLE_DISPLAY_NAME[user.role]}`,
            team && `Team: ${escapeMrkdwn(team.name)}`,
            !user.is_active && 'Status: Inactive',
          ]
            .filter(Boolean)
            .join(' · '),
          user.contract_start_date &&
            `Contract start: ${formatDate(user.contract_start_date)}`,
          // What HR entered counts in the year the person joined; later
          // years carry over on their own (their usage shows it).
          !!user.carryover_days &&
            isJoinedYear(user) &&
            `Carryover: ${user.carryover_days} days`,
        ],
        accessory: this.getUserRowAccessory(user, userRole),
      }),
    );

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

const isJoinedYear = (user: IUserViewModel) =>
  getJoinedVacationPeriod(
    user.contract_start_date,
    user.created_at,
  ).periodStart.getTime() ===
  getCurrentVacationPeriod(user.contract_start_date).periodStart.getTime();
