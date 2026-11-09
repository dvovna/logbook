import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { ISearchResult } from '@common/types/pagination.types';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { STATUS_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-status.options';
import capitalize from '@common/utils/capitalize';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { VACATION_TYPE_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-type.options';
import VacationType from '@common/enums/vacation-type.enum';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import UserRole from '@common/enums/user-role.enum';
import { getVacationStatusEmoji } from '@modules/slack/tabs/vacation-requests/utils/vacation-status-icon';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { IOption } from '@common/types/option.interface';

export interface IVacationRequestsTabFilters {
  user?: {
    id: string;
    name: string;
  };
  userName?: string;
  teamId?: string;
  year?: string;
  type?: VacationType;
  status?: VacationRequestStatus;
}

export interface IVacationRequestsTabMetadata {
  filters?: IVacationRequestsTabFilters;
  page?: number;
}

interface IGetViewParams extends IBaseTabViewParams {
  requests: ISearchResult<IVacationRequestViewModel>;
  teams: ITeamViewModel[];
  years: number[];
}

@Injectable()
export class VacationRequestsTabView extends BaseTabView<
  IGetViewParams,
  IVacationRequestsTabMetadata
> {
  protected callbackId: ViewCallbackId = ViewCallbackId.VacationRequestsTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected getTabTitle(): string {
    return `*${SCREENS[ScreenId.AllRequests].title}*\nEveryone's time off you can see, with what became of it.`;
  }

  protected getTitleAccessory({
    userRole,
  }: IGetViewParams): SectionBlockAccessory | null {
    return this.slackActionPermissionsService.can(
      userRole,
      VacationRequestsTabViewActionId.CreateRequest,
    )
      ? {
          type: 'button',
          text: { type: 'plain_text', text: '➕ Add Vacation Request' },
          action_id: VacationRequestsTabViewActionId.CreateRequest,
        }
      : null;
  }

  protected getContentBlocks(
    { requests, teams, years, userRole }: IGetViewParams,
    metadata?: IVacationRequestsTabMetadata,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];
    const filters = metadata?.filters;

    blocks.push(...this.getFiltersBlocks(teams, years, filters));

    blocks.push(...this.getRequestsListBlocks(requests, userRole));

    return blocks;
  }

  private getRequestItemBlocks = (
    vacationRequest: IVacationRequestViewModel,
    userRole: UserRole,
  ): AnyBlock[] => {
    const statusEmoji = getVacationStatusEmoji(vacationRequest.status);

    const dates = formatDateRange(
      vacationRequest.start_date,
      vacationRequest.end_date,
    );

    return ListItem.getBlocks({
      title: vacationRequest.user?.name || 'Unknown',
      details: [
        `${VACATION_TYPE_DISPLAY_NAME_MAP[vacationRequest.type]} · ${dates}`,
        [
          `Days: ${vacationRequest.days} (${vacationRequest.working_days} working)`,
          `Status: ${statusEmoji} ${capitalize(vacationRequest.status)}`,
          vacationRequest.team &&
            `Team: ${escapeMrkdwn(vacationRequest.team.name)}`,
        ]
          .filter(Boolean)
          .join(' · '),
      ],
      accessory: {
        type: 'overflow',
        action_id: VacationRequestsTabViewActionId.ManageRequestMenu,
        options: this.getManageRequestMenuOptions(vacationRequest, userRole),
      },
    });
  };

  private getManageRequestMenuOptions(
    vacationRequest: IVacationRequestViewModel,
    userRole: UserRole,
  ): PlainTextOption[] {
    const options: PlainTextOption[] = [
      {
        text: { type: 'plain_text', text: 'View Details' },
        value: `${VacationRequestsTabViewActionId.ViewDetails}:${vacationRequest.id}`,
      },
    ];

    if (
      this.slackActionPermissionsService.can(
        userRole,
        VacationRequestsTabViewActionId.EditRequest,
      )
    ) {
      options.push({
        text: { type: 'plain_text', text: 'Edit Request' },
        value: `${VacationRequestsTabViewActionId.EditRequest}:${vacationRequest.id}`,
      });
    }

    // So a request doesn't get stuck when an approver is away.
    if (
      vacationRequest.status === VacationRequestStatus.Pending &&
      this.slackActionPermissionsService.can(
        userRole,
        VacationRequestsTabViewActionId.ApproveOnBehalf,
      )
    ) {
      options.push({
        text: { type: 'plain_text', text: 'Approve for Approvers' },
        value: `${VacationRequestsTabViewActionId.ApproveOnBehalf}:${vacationRequest.id}`,
      });
    }

    if (
      this.slackActionPermissionsService.can(
        userRole,
        VacationRequestsTabViewActionId.DeleteRequest,
      )
    ) {
      options.push({
        text: { type: 'plain_text', text: 'Delete Request' },
        value: `${VacationRequestsTabViewActionId.DeleteRequest}:${vacationRequest.id}`,
      });
    }

    return options;
  }

  private getRequestsListBlocks(
    requestsData: ISearchResult<IVacationRequestViewModel>,
    userRole: UserRole,
  ): AnyBlock[] {
    return PaginatedListView.getBlocks<IVacationRequestViewModel>({
      itemsData: requestsData,
      getItemBlocks: (item) => this.getRequestItemBlocks(item, userRole),
      prevPageActionId: VacationRequestsTabViewActionId.PaginationPrev,
      nextPageActionId: VacationRequestsTabViewActionId.PaginationNext,
      emptyText: '_No vacation requests found_',
    });
  }

  private getFiltersBlocks(
    teams: ITeamViewModel[],
    years: number[],
    filters?: IVacationRequestsTabFilters,
  ) {
    const yearsOptions: IOption[] = years.map((year) => ({
      id: year.toString(),
      name: year.toString(),
    }));

    const vacationRequestsFilters: IFiltersConfig[] = [
      {
        type: 'external_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByUser,
        placeholder: 'Filter by User',
        minQueryLength: 2,
        initialOption: filters?.user,
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByType,
        placeholder: 'Filter by Type',
        options: VACATION_TYPE_OPTIONS,
        initialValue: filters?.type,
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByTeam,
        placeholder: 'Filter by Team',
        options: teams,
        initialValue: filters?.teamId,
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByYear,
        placeholder: 'Filter by Year',
        options: yearsOptions,
        initialValue: filters?.year,
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByStatus,
        placeholder: 'Filter by Status',
        options: STATUS_OPTIONS,
        initialValue: filters?.status,
      },
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: vacationRequestsFilters,
      separator: false,
      resetButtonActionId: VacationRequestsTabViewActionId.ResetFilters,
    });
  }
}
