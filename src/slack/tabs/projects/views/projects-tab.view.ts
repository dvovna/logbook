import {
  labelOptions,
  PROJECT_STATUS_LABELS,
  vacationTypeLabel,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import { getDisplayTime } from '@common/utils/time.utils';
import { ITimeOffSetup } from 'src/time-off-logging/types/time-off-settings.types';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import {
  ListItem,
  detail,
} from '@modules/slack/common/views/components/list-item.view';
import { listNames } from '@modules/slack/common/utils/list.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { IOption } from '@common/types/option.interface';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { truncate } from 'lodash';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { IProjectsListData } from 'src/projects/types/projects-list.types';
import { IProjectListItem } from 'src/projects/types/project-list-item.types';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { BILLABLE_PLAIN_TEXT_OPTIONS } from '@modules/slack/tabs/projects/data/billable-options';
import { IncludeArchivedButtonView } from '@modules/slack/common/views/components/include-archvied-button.view';
import UserRole from '@common/enums/user-role.enum';
import { formatHourlyRate } from '@common/utils/money.utils';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';

export interface IProjectTabFilters {
  project?: IOption;
  status?: ProjectStatus;
  billable?: YesNoValue;
}

export const PROJECTS_TAB_PAGE_SIZE = 10;

interface IGetProjectsViewParams extends IBaseTabViewParams {
  projectsListData: IProjectsListData;
  // Names of the people assigned to each listed project.
  peopleByProject: Record<string, string[]>;
  // Rates by project and the workspace's currency, for Admin and Finance; null
  // for anyone else.
  rates: Map<string, IProjectRates> | null;
  currency: string | null;
  // What time off is logged as, for whoever may set it; null for anyone else.
  timeOff: ITimeOffSetup | null;
}

// People's own rates shown on a project.
const SHOWN_PERSON_RATES = 5;

export interface IProjectsTabMetaData {
  page?: number;
  includeArchived?: boolean;
  filters?: IProjectTabFilters;
}

@Injectable()
export class ProjectsTabView extends BaseTabView<
  IGetProjectsViewParams,
  IProjectsTabMetaData
> {
  protected callbackId = ViewCallbackId.ProjectsTabView;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected getTabTitle() {
    return `*${SCREENS[ScreenId.Projects].title}*\nWho tracks time on which project: its teams and people.`;
  }

  protected getTitleAccessory({
    userRole,
  }: IGetProjectsViewParams): SectionBlockAccessory | null {
    if (
      !this.slackActionPermissionsService.can(
        userRole,
        ProjectsTabViewActionId.AddProject,
      )
    ) {
      return null;
    }

    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Project' },
      action_id: ProjectsTabViewActionId.AddProject,
    };
  }

  protected getContentBlocks(
    {
      projectsListData,
      userRole,
      peopleByProject,
      rates,
      currency,
      timeOff,
    }: IGetProjectsViewParams,
    { filters, includeArchived, page }: IProjectsTabMetaData,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    if (currency) {
      blocks.push(this.getCurrencyBlock(currency, userRole));
    }

    if (
      timeOff &&
      this.slackActionPermissionsService.can(
        userRole,
        ProjectsTabViewActionId.TimeOffSettings,
      )
    ) {
      blocks.push(this.getTimeOffBlock(timeOff));
    }

    blocks.push(...this.getFiltersBlocks(filters));
    blocks.push(
      IncludeArchivedButtonView.getView({
        actionId: ProjectsTabViewActionId.IncludeArchivedProjects,
        title: 'Include Archived Projects',
        includeArchived,
      }),
    );

    const listBlocks = PaginatedListView.getBlocks<IProjectListItem>({
      itemsData: {
        ...projectsListData,
        page: page || 1,
        pageSize: PROJECTS_TAB_PAGE_SIZE,
      },
      getItemBlocks: (item: IProjectListItem) =>
        this.getProjectListItemBlocks(
          item,
          userRole,
          peopleByProject[item.id] ?? [],
          rates && currency
            ? this.getRateDetails(rates.get(item.id), currency)
            : [],
        ),
      prevPageActionId: ProjectsTabViewActionId.PaginationPrev,
      nextPageActionId: ProjectsTabViewActionId.PaginationNext,
      emptyText: '_No projects found._',
      emptyAction: this.slackActionPermissionsService.can(
        userRole,
        ProjectsTabViewActionId.AddProject,
      )
        ? {
            text: 'Add a project',
            actionId: ProjectsTabViewActionId.AddProject,
          }
        : undefined,
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  // An admin's button to choose the projects that time off is logged on, and
  // what is set: 'Annual leave → Vacations · Sick leave → Sick · 8h a day'.
  private getTimeOffBlock({
    minutesPerDay,
    projects,
  }: ITimeOffSetup): AnyBlock {
    const setup = projects.length
      ? [
          ...projects.map(
            ({ type, projectName }) =>
              `${vacationTypeLabel(type)} → ${escapeMrkdwn(projectName)}`,
          ),
          `${getDisplayTime(minutesPerDay)} a day`,
        ].join(' · ')
      : 'No leave type has a project yet.';

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Approved time off can be logged as time on a project of its leave type.\n${setup}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '🌴 Time off projects' },
        action_id: ProjectsTabViewActionId.TimeOffSettings,
      },
    };
  }

  // "Rates and amounts are in USD", and for an admin the button to change it.
  private getCurrencyBlock(currency: string, userRole: UserRole): AnyBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Rates and amounts are in *${currency}*.`,
      },
      ...(this.slackActionPermissionsService.can(
        userRole,
        ProjectsTabViewActionId.ChangeCurrency,
      )
        ? {
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'Change currency' },
              action_id: ProjectsTabViewActionId.ChangeCurrency,
            },
          }
        : {}),
    };
  }

  // The project's rate and the people's own rates on it.
  private getRateDetails(
    projectRates: IProjectRates | undefined,
    currency: string,
  ): string[] {
    const hourlyRate = projectRates?.hourlyRate ?? null;
    const personRates = projectRates?.personRates ?? [];
    const shown = personRates
      .slice(0, SHOWN_PERSON_RATES)
      .map(
        ({ name, hourlyRate: rate }) =>
          `${escapeMrkdwn(name)} ${formatHourlyRate(rate, currency)}`,
      );
    const left = personRates.length - shown.length;

    return [
      detail(
        'Rate',
        hourlyRate === null ? 'none' : formatHourlyRate(hourlyRate, currency),
      )!,
      ...(shown.length
        ? [
            detail(
              'Own rates',
              shown.join(', ') + (left ? ` and ${left} more` : ''),
            )!,
          ]
        : []),
    ];
  }

  private getProjectListItemBlocks(
    project: IProjectListItem,
    userRole: UserRole,
    people: string[],
    rateDetails: string[],
  ): AnyBlock[] {
    const menuOptions = this.getProjectMenuOptions(project, userRole);

    return ListItem.getBlocks({
      title: project.name,
      details: [
        detail(
          'Client',
          project.client_name && escapeMrkdwn(project.client_name),
        ),
        detail('Status', withIcon(PROJECT_STATUS_LABELS[project.status])),
        detail('Billable', project.billable ? 'Yes' : 'No'),
        ...rateDetails,
        detail(
          'Teams',
          project.teams?.length ? listNames(project.teams) : 'none',
        ),
        detail('People', people.length ? listNames(people) : 'none'),
        detail(
          'Description',
          project.description && escapeMrkdwn(truncate(project.description)),
        ),
        project.archived_at && `*Archived:* ${formatDate(project.archived_at)}`,
      ],
      ...(menuOptions.length
        ? {
            accessory: {
              type: 'overflow',
              action_id: ProjectsTabViewActionId.ManageProjectMenu,
              options: menuOptions,
            },
          }
        : {}),
    });
  }

  // The menu items the user's role allows; an archived project can only be
  // restored.
  private getProjectMenuOptions(project: IProjectListItem, userRole: UserRole) {
    const items = project.archived_at
      ? [
          {
            id: ProjectsTabViewActionId.ArchiveProject,
            name: 'Restore Project',
          },
        ]
      : [
          { id: ProjectsTabViewActionId.EditProject, name: 'Edit Project' },
          {
            id: ProjectsTabViewActionId.ManageProjectAssignments,
            name: 'Manage Assignments',
          },
          {
            id: ProjectsTabViewActionId.ManagePersonRates,
            name: 'Person Rates',
          },
          {
            id: ProjectsTabViewActionId.ArchiveProject,
            name: 'Archive Project',
          },
        ];

    return items
      .filter(({ id }) => this.slackActionPermissionsService.can(userRole, id))
      .map(({ id, name }) => ({
        text: { type: 'plain_text' as const, text: name },
        value: `${id}:${project.id}`,
      }));
  }

  private getFiltersBlocks(filters?: IProjectTabFilters) {
    const projectFilters: IFiltersConfig[] = [
      {
        type: 'external_select',
        actionId: ProjectsTabViewActionId.FindProjectByName,
        placeholder: 'Find Project',
        minQueryLength: 2,
        initialOption: filters?.project,
      },
      {
        type: 'static_select',
        actionId: ProjectsTabViewActionId.FilterByStatus,
        placeholder: 'Status',
        options: labelOptions(PROJECT_STATUS_LABELS),
        initialValue: filters?.status,
      },
      {
        type: 'static_select',
        actionId: ProjectsTabViewActionId.FilterByBillable,
        placeholder: 'Billable',
        options: BILLABLE_PLAIN_TEXT_OPTIONS,
        initialValue: filters?.billable,
      },
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: projectFilters,
      separator: false,
      resetButtonActionId: ProjectsTabViewActionId.ResetFilters,
    });
  }
}
