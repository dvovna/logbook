import { Injectable } from '@nestjs/common';
import { ActionsBlock, AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { ISearchResult } from 'src/common/types/pagination.types';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import PaginationView from 'src/slack/common/views/pagination.view';
import {
  ALL_STATUSES_OPTION,
  STATUS_OPTIONS,
} from 'src/slack/tabs/vacation-requests/views/options/vacation-status.options';
import { ALL_OPTION_VALUE } from 'src/slack/common/views/data/all-option-value';
import capitalize from 'src/common/utils/capitalize';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { VACATION_TYPE_OPTIONS } from 'src/slack/tabs/vacation-requests/views/options/vacation-type.options';
import VacationType from 'src/common/enums/vacation-type.enum';
import { IBaseTabViewParams } from 'src/slack/common/views/base-tab.view';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';

export interface IVacationRequestsTabFilters {
  user?: {
    value: string;
    name: string;
  };
  userName?: string;
  teamId?: string;
  year?: string;
  type?: VacationType;
  status?: VacationStatus;
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
  RequestsPaginationPrev = 'requests_pagination_prev',
  RequestsPaginationNext = 'requests_pagination_next',
  ManageRequestMenu = 'manage_request_menu',
  UserField = 'user',
  CreateRequest = 'create_request',
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

  protected getAdminTabContentBlocks(
    { requests, teams, years }: IGetViewParams,
    metadata?: IVacationRequestsTabMetadata,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];
    const filters = metadata?.filters;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*🌴 Vacation Requests Management*' },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '➕ Add Vacation Request' },
        action_id: VacationRequestsTabViewActionId.CreateRequest,
      },
    });

    blocks.push(this.getFiltersBlock(teams, years, filters));

    blocks.push(...this.getRequestsListBlocks(requests));

    blocks.push(
      ...PaginationView.getBlocks({
        page: requests.page,
        totalCount: requests.totalCount,
        pageSize: requests.pageSize,
        prevPageActionId:
          VacationRequestsTabViewActionId.RequestsPaginationPrev,
        nextPageActionId:
          VacationRequestsTabViewActionId.RequestsPaginationNext,
      }),
    );

    return blocks;
  }

  private getRequestItemBlocks = (
    vacationRequest: IVacationRequestViewModel,
  ): AnyBlock[] => {
    const statusEmoji =
      vacationRequest.status === VacationStatus.Approved
        ? '✅'
        : vacationRequest.status === VacationStatus.Rejected
          ? '❌'
          : '⏳';

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
          {
            type: 'mrkdwn',
            text: `Team: ${vacationRequest.team?.name || '-'}`,
          },
          { type: 'mrkdwn', text: `📅 ${start} → ${end}` },
          {
            type: 'mrkdwn',
            text: `Status: ${statusEmoji} ${capitalize(vacationRequest.status)}`,
          },
          { type: 'mrkdwn', text: `Days: ${vacationRequest.days}` },
          {
            type: 'mrkdwn',
            text: `Working Days: ${vacationRequest.working_days}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: VacationRequestsTabViewActionId.ManageRequestMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit Request' },
              value: `${VacationRequestsTabViewActionId.EditRequest}:${vacationRequest.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Delete Request' },
              value: `${VacationRequestsTabViewActionId.DeleteRequest}:${vacationRequest.id}`,
            },
          ],
        },
      },
      { type: 'divider' },
    ];
  };

  private getRequestsListBlocks(
    requests: ISearchResult<IVacationRequestViewModel>,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    if (requests.items.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No vacation requests found_' },
      });

      return blocks;
    }

    const itemBlocks = requests.items.map(this.getRequestItemBlocks);

    blocks.push(...itemBlocks.flat());

    return blocks;
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
