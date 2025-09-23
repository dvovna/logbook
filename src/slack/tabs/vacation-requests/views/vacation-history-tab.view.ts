import { Injectable } from '@nestjs/common';
import { ActionsBlock, AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ISearchResult } from 'src/common/types/pagination.types';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { ALL_OPTION_VALUE } from 'src/slack/common/views/data/all-option-value';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { VACATION_TYPE_OPTIONS } from 'src/slack/tabs/vacation-requests/views/options/vacation-type.options';
import VacationType from 'src/common/enums/vacation-type.enum';
import {
  BaseTabView,
  IBaseTabViewParams,
} from 'src/slack/common/views/base-tab.view';
import { PaginatedListView } from 'src/slack/common/views/components/paginated-list.view';
import { CommonViewActionId } from 'src/slack/enums/common-view-action-id.enum';

export interface IVacationHistoryTabFilters {
  year?: string;
  type?: VacationType;
}

export interface IVacationHistoryTabMetadata {
  filters?: IVacationHistoryTabFilters;
  page?: number;
}

interface IGetViewParams extends IBaseTabViewParams {
  requests: ISearchResult<IVacationRequestViewModel>;
  years: number[];
}

export enum VacationHistoryTabViewActionId {
  ManageRequestMenu = 'manage_request_menu',
  ViewDetails = 'vacation_view_details',
  PaginationPrev = 'requests_pagination_prev',
  PaginationNext = 'requests_pagination_next',
  FilterRequestsByYear = 'filter_requests_by_year',
  FilterRequestsByType = 'filter_requests_by_type',
}

const ALL_TYPES_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Types' },
  value: ALL_OPTION_VALUE,
};

const ALL_YEARS_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Years' },
  value: ALL_OPTION_VALUE,
};

@Injectable()
export class VacationHistoryTabView extends BaseTabView<
  IGetViewParams,
  IVacationHistoryTabMetadata
> {
  protected callbackId: ViewCallbackId = ViewCallbackId.VacationHistoryTabView;

  protected getTabTitle(): string {
    return '*🌴 Vacation History*';
  }

  protected getContentBlocks(
    { requests, years }: IGetViewParams,
    metadata?: IVacationHistoryTabMetadata,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];
    const filters = metadata?.filters;

    blocks.push(this.getBackButtonBlock());
    blocks.push(this.getFiltersBlock(years, filters));

    blocks.push(...this.getRequestsListBlocks(requests));

    return blocks;
  }

  private getBackButtonBlock() {
    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '⬅️ Back To Home' },
          action_id: CommonViewActionId.BackToHomeTab,
        },
      ],
    };
  }

  private getRequestItemBlocks = (
    vacationRequest: IVacationRequestViewModel,
  ): AnyBlock[] => {
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
          { type: 'mrkdwn', text: `Days: ${vacationRequest.days}` },
          { type: 'mrkdwn', text: `📅 ${start} → ${end}` },
          {
            type: 'mrkdwn',
            text: `Working Days: ${vacationRequest.working_days}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: VacationHistoryTabViewActionId.ManageRequestMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'View Details' },
              value: `${VacationHistoryTabViewActionId.ViewDetails}:${vacationRequest.id}`,
            },
          ],
        },
      },
      { type: 'divider' },
    ];
  };

  private getRequestsListBlocks(
    requestsData: ISearchResult<IVacationRequestViewModel>,
  ): AnyBlock[] {
    return PaginatedListView.getBlocks<IVacationRequestViewModel>({
      itemsData: requestsData,
      getItemBlocks: (item) => this.getRequestItemBlocks(item),
      prevPageActionId: VacationHistoryTabViewActionId.PaginationPrev,
      nextPageActionId: VacationHistoryTabViewActionId.PaginationNext,
      emptyText: '_No vacation requests found_',
    });
  }

  private getFiltersBlock(
    years: number[],
    filters?: IVacationHistoryTabFilters,
  ): ActionsBlock {
    const yearsOptions = years.map<PlainTextOption>((year) => ({
      text: { type: 'plain_text', text: year.toString() },
      value: year.toString(),
    }));

    return {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Vacation Type' },
          action_id: VacationHistoryTabViewActionId.FilterRequestsByType,
          initial_option:
            VACATION_TYPE_OPTIONS.find(
              (type) => type.value === filters?.type,
            ) || ALL_TYPES_OPTION,
          options: [ALL_TYPES_OPTION, ...VACATION_TYPE_OPTIONS],
        },
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Year' },
          action_id: VacationHistoryTabViewActionId.FilterRequestsByYear,
          initial_option: {
            text: {
              type: 'plain_text',
              text: filters?.year || 'All Years',
            },
            value: filters?.year || ALL_OPTION_VALUE,
          },
          options: [ALL_YEARS_OPTION, ...yearsOptions],
        },
      ],
    };
  }
}
