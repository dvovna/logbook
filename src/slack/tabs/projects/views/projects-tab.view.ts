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
import capitalize from '@common/utils/capitalize';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { PROJECT_STATUS_OPTIONS } from '@modules/slack/tabs/projects/data/project-status-options';
import { BILLABLE_PLAIN_TEXT_OPTIONS } from '@modules/slack/tabs/projects/data/billable-options';
import { IncludeArchivedButtonView } from '@modules/slack/common/views/components/include-archvied-button.view';
import UserRole from '@common/enums/user-role.enum';

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
}

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
    return '🗂 *Projects, Teams & Assignments*\n\nControl which teams and users can track time on specific projects.';
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
    { projectsListData, userRole, peopleByProject }: IGetProjectsViewParams,
    { filters, includeArchived, page }: IProjectsTabMetaData,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

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

  private getProjectListItemBlocks(
    project: IProjectListItem,
    userRole: UserRole,
    people: string[],
  ): AnyBlock[] {
    const menuOptions = this.getProjectMenuOptions(project, userRole);

    return ListItem.getBlocks({
      title: project.name,
      details: [
        detail(
          'Client',
          project.client_name && escapeMrkdwn(project.client_name),
        ),
        detail('Status', capitalize(project.status)),
        detail('Billable', project.billable ? 'Yes' : 'No'),
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
        options: PROJECT_STATUS_OPTIONS,
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
