import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import capitalize from '@common/utils/capitalize';
import { getVacationStatusEmoji } from '@modules/slack/tabs/vacation-requests/utils/vacation-status-icon';
import { STATUS_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-status.options';
import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ISearchResult } from '@common/types/pagination.types';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { VACATION_TYPE_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-type.options';
import VacationType from '@common/enums/vacation-type.enum';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { CommonViewActionId } from '@modules/slack/enums/common-view-action-id.enum';
import { Divider } from '@modules/slack/common/views/components/separator';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';

export interface IVacationHistoryTabFilters {
  year?: string;
  type?: VacationType;
  status?: VacationRequestStatus;
}

export interface IVacationHistoryTabMetadata {
  filters?: IVacationHistoryTabFilters;
  page?: number;
}

interface IGetViewParams extends IBaseTabViewParams {
  requests: ISearchResult<IVacationRequestViewModel>;
  years: number[];
}

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
    blocks.push(...this.getFilterBlocks(years, filters));

    blocks.push(...this.getRequestsListBlocks(requests));

    return blocks;
  }

  private getBackButtonBlock() {
    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '⬅️ Back' },
          action_id: CommonViewActionId.BackToHomeTab,
        },
      ],
    };
  }

  private getRequestItemBlocks = (
    vacationRequest: IVacationRequestViewModel,
  ): AnyBlock[] => {
    const dates = formatDateRange(
      vacationRequest.start_date,
      vacationRequest.end_date,
    );

    return [
      {
        type: 'section',
        // The user's own requests: what and when, and how it was decided.
        fields: [
          {
            type: 'mrkdwn',
            text: `*${VACATION_TYPE_DISPLAY_NAME_MAP[vacationRequest.type]}*`,
          },
          {
            type: 'mrkdwn',
            text: `Status: ${getVacationStatusEmoji(vacationRequest.status)} ${capitalize(vacationRequest.status)}`,
          },
          { type: 'mrkdwn', text: `📅 ${dates}` },
          {
            type: 'mrkdwn',
            text: `Days: ${vacationRequest.days} (${vacationRequest.working_days} working)`,
          },
          ...(vacationRequest.rejection_reason
            ? [
                {
                  type: 'mrkdwn' as const,
                  text: `Reason: ${escapeMrkdwn(vacationRequest.rejection_reason.replace(/\s+/g, ' '))}`,
                },
              ]
            : []),
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
      ...Divider.getBlocks(),
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

  private getFilterBlocks(
    years: number[],
    filters?: IVacationHistoryTabFilters,
  ) {
    const yearsOptions = years.map((year) => ({
      name: year.toString(),
      id: year.toString(),
    }));

    const vacationHistoryFilters: IFiltersConfig[] = [
      {
        type: 'static_select',
        actionId: VacationHistoryTabViewActionId.FilterRequestsByType,
        placeholder: 'Vacation Type',
        options: VACATION_TYPE_OPTIONS,
        initialValue: filters?.type,
      },
      {
        type: 'static_select',
        actionId: VacationHistoryTabViewActionId.FilterRequestsByYear,
        placeholder: 'Year',
        options: yearsOptions,
        initialValue: filters?.year,
      },
      {
        type: 'static_select',
        actionId: VacationHistoryTabViewActionId.FilterRequestsByStatus,
        placeholder: 'Status',
        options: STATUS_OPTIONS,
        initialValue: filters?.status,
      },
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: vacationHistoryFilters,
      resetButtonActionId: VacationHistoryTabViewActionId.ResetFilters,
    });
  }
}
