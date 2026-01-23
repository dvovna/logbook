import { Injectable } from '@nestjs/common';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { ISearchResult } from '@common/types/pagination.types';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import {
  STATUS_OPTIONS,
} from '@modules/slack/tabs/vacation-requests/views/options/vacation-status.options';
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
import {
  VacationRequestsTabViewActionId,
} from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { FiltersBlockBuilder, IFiltersConfig } from '@modules/slack/common/views/builders/filters-block.builder';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

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

@Injectable()
export class VacationRequestsTabView extends BaseAdminTabView<
  IGetViewParams,
  IVacationRequestsTabMetadata
> {
  protected callbackId: ViewCallbackId = ViewCallbackId.VacationRequestsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageVacations;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*🌴 Vacation Requests Management*\n\nSubmit and manage employee vacation requests';
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManageVacations);
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

  private getFiltersBlocks(
    teams: ITeamViewModel[],
    years: number[],
    filters?: IVacationRequestsTabFilters,
  ) {
    const teamOptions: PlainTextOption[] = teams.map((team) =>
      toPlainTextOption({
        id: team.id,
        name: team.name,
      }),
    );

    const yearsOptions: PlainTextOption[] = years.map((year) =>
      toPlainTextOption({
        id: year.toString(),
        name: year.toString(),
      }),
    );

    const vacationRequestsFilters: IFiltersConfig[] = [
      {
        type: 'external_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByUser,
        placeholder: 'Filter by User',
        minQueryLength: 2,
        initialOption: filters?.user
          ? toPlainTextOption({
            id: filters.user.value,
            name: filters.user.name,
          })
          : undefined,
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByType,
        placeholder: 'Filter by Type',
        options: VACATION_TYPE_OPTIONS,
        initialOption: VACATION_TYPE_OPTIONS.find(
          (type) => type.value === filters?.type,
        ),
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByTeam,
        placeholder: 'Filter by Team',
        options: teamOptions,
        initialOption: teamOptions.find(
          (team) => team.value === filters?.teamId,
        ),
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByYear,
        placeholder: 'Filter by Year',
        options: yearsOptions,
        initialOption: yearsOptions.find(
          (year) => year.value === filters?.year,
        ),
      },
      {
        type: 'static_select',
        actionId: VacationRequestsTabViewActionId.FilterRequestsByStatus,
        placeholder: 'Filter by Status',
        options: STATUS_OPTIONS,
        initialOption: STATUS_OPTIONS.find(
          (status) => status.value === filters?.status,
        ),
      },
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: vacationRequestsFilters,
      separator: false,
      resetButtonActionId: VacationRequestsTabViewActionId.ResetFilters,
    });
  }
}
