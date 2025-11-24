import { Injectable } from '@nestjs/common';
import { ActionsBlock, AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { ISearchResult } from '@common/types/pagination.types';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import {
  ALL_STATUSES_OPTION,
  STATUS_OPTIONS,
} from '@modules/slack/tabs/vacation-requests/views/options/vacation-status.options';
import { ALL_OPTION_VALUE } from '@modules/slack/common/views/data/all-option-value';
import capitalize from '@common/utils/capitalize';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { VACATION_TYPE_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-type.options';
import VacationType from '@common/enums/vacation-type.enum';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import UserRole from '@common/enums/user-role.enum';
import { getVacationStatusEmoji } from '@modules/slack/tabs/vacation-requests/utils/vacation-status-icon';
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';

export interface IVacationRequestsTabFilters {
  user?: {
    value: string;
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

export enum VacationRequestsTabViewActionId {
  PaginationPrev = 'requests_pagination_prev',
  PaginationNext = 'requests_pagination_next',
  ManageRequestMenu = 'manage_request_menu',
  UserField = 'user',
  CreateRequest = 'create_request',
  ViewDetails = 'view_details',
  EditRequest = 'edit_request',
  DeleteRequest = 'delete_request',
  FilterRequestsByUser = 'filter_requests_by_user',
  FilterRequestsByTeam = 'filter_requests_by_team',
  FilterRequestsByYear = 'filter_requests_by_year',
  FilterRequestsByType = 'filter_requests_by_type',
  FilterRequestsByStatus = 'filter_requests_by_status',
}

const ALL_TEAMS_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Teams' },
  value: ALL_OPTION_VALUE,
};

const ALL_TYPES_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Types' },
  value: ALL_OPTION_VALUE,
};

const ALL_YEARS_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Years' },
  value: ALL_OPTION_VALUE,
};

@Injectable()
export class VacationRequestsTabView extends BaseAdminTabView<
  IGetViewParams,
  IVacationRequestsTabMetadata
> {
  protected callbackId: ViewCallbackId = ViewCallbackId.VacationRequestsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageVacationRequests;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*🌴 Vacation Requests Management*\n\nSubmit and manage employee vacation requests';
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

    blocks.push(this.getFiltersBlock(teams, years, filters));

    blocks.push(...this.getRequestsListBlocks(requests, userRole));

    return blocks;
  }

  private getRequestItemBlocks = (
    vacationRequest: IVacationRequestViewModel,
    userRole: UserRole,
  ): AnyBlock[] => {
    const statusEmoji = getVacationStatusEmoji(vacationRequest.status);

    const start = new Date(vacationRequest.start_date).toLocaleDateString();
    const end = new Date(vacationRequest.end_date).toLocaleDateString();

    return [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*${vacationRequest.user?.name || 'Unknown'}* (${VACATION_TYPE_DISPLAY_NAME_MAP[vacationRequest.type]})`,
          },
          { type: 'mrkdwn', text: `📅 ${start} → ${end}` },
          {
            type: 'mrkdwn',
            text: `Team: ${vacationRequest.team?.name || '-'}`,
          },
          { type: 'mrkdwn', text: `Days: ${vacationRequest.days}` },
          {
            type: 'mrkdwn',
            text: `Status: ${statusEmoji} ${capitalize(vacationRequest.status)}`,
          },
          {
            type: 'mrkdwn',
            text: `Working Days: ${vacationRequest.working_days}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: VacationRequestsTabViewActionId.ManageRequestMenu,
          options: this.getManageRequestMenuOptions(vacationRequest, userRole),
        },
      },
      ...SeparatorComponent.getBlocks(),
    ];
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

  private getFiltersBlock(
    teams: ITeamViewModel[],
    years: number[],
    filters?: IVacationRequestsTabFilters,
  ): ActionsBlock {
    const teamOptions = teams.map<PlainTextOption>((team) => ({
      text: { type: 'plain_text', text: team.name },
      value: team.id,
    }));

    const yearsOptions = years.map<PlainTextOption>((year) => ({
      text: { type: 'plain_text', text: year.toString() },
      value: year.toString(),
    }));

    return {
      type: 'actions',
      elements: [
        {
          type: 'external_select',
          action_id: VacationRequestsTabViewActionId.FilterRequestsByUser,
          placeholder: {
            type: 'plain_text',
            text: 'All Users',
          },
          initial_option: filters?.user?.value
            ? {
              value: filters.user.value,
              text: { type: 'plain_text', text: filters.user.name },
            }
            : undefined,
          min_query_length: 2,
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Type' },
          action_id: VacationRequestsTabViewActionId.FilterRequestsByType,
          initial_option:
            VACATION_TYPE_OPTIONS.find(
              (type) => type.value === filters?.type,
            ) || ALL_TYPES_OPTION,
          options: [ALL_TYPES_OPTION, ...VACATION_TYPE_OPTIONS],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Team' },
          action_id: VacationRequestsTabViewActionId.FilterRequestsByTeam,
          initial_option: {
            text: {
              type: 'plain_text',
              text:
                teams.find((t) => t.id === filters?.teamId)?.name ||
                'All Teams',
            },
            value: filters?.teamId || ALL_OPTION_VALUE,
          },
          options: [ALL_TEAMS_OPTION, ...teamOptions],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Year' },
          action_id: VacationRequestsTabViewActionId.FilterRequestsByYear,
          initial_option: {
            text: {
              type: 'plain_text',
              text: filters?.year || 'All Years',
            },
            value: filters?.year || ALL_OPTION_VALUE,
          },
          options: [ALL_YEARS_OPTION, ...yearsOptions],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Filter by Status' },
          action_id: VacationRequestsTabViewActionId.FilterRequestsByStatus,
          initial_option:
            STATUS_OPTIONS.find((s) => s.value === filters?.status) ||
            ALL_STATUSES_OPTION,
          options: [ALL_STATUSES_OPTION, ...STATUS_OPTIONS],
        },
      ],
    };
  }
}
