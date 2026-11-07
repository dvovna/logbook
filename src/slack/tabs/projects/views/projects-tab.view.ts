import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { truncate } from 'lodash';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { IProjectsListData } from 'src/projects/types/projects-list.types';
import { IProjectListItem } from 'src/projects/types/project-list-item.types';
import capitalize from '@common/utils/capitalize';
import {
  IProjectTabFilters,
  PROJECTS_TAB_PAGE_SIZE,
} from '@modules/slack/tabs/projects/services/projects-tab.service';
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { PROJECT_STATUS_OPTIONS } from '@modules/slack/tabs/projects/data/project-status-options';
import { BILLABLE_PLAIN_TEXT_OPTIONS } from '@modules/slack/tabs/projects/data/billable-options';
import { IncludeArchivedButtonView } from '@modules/slack/common/views/components/include-archvied-button.view';
import UserRole from '@common/enums/user-role.enum';

interface IGetProjectsViewParams extends IBaseTabViewParams {
  projectsListData: IProjectsListData;
}

export interface IProjectsTabMetaData {
  page?: number;
  includeArchived?: boolean;
  filters?: IProjectTabFilters;
}

@Injectable()
export class ProjectsTabView extends BaseAdminTabView<
  IGetProjectsViewParams,
  IProjectsTabMetaData
> {
  protected callbackId = ViewCallbackId.ProjectsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageTimeAndBilling;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
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

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManageTimeAndBilling);
  }

  protected getContentBlocks(
    { projectsListData, userRole }: IGetProjectsViewParams,
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
        this.getProjectListItemBlocks(item, userRole),
      prevPageActionId: ProjectsTabViewActionId.PaginationPrev,
      nextPageActionId: ProjectsTabViewActionId.PaginationNext,
      emptyText: '_No projects found_',
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getProjectListItemBlocks(
    project: IProjectListItem,
    userRole: UserRole,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const updatedAt = formatDate(project.updated_at);
    const createdAt = formatDate(project.created_at);
    const archivedAt = project.archived_at && formatDate(project.archived_at);
    const menuOptions = this.getProjectMenuOptions(project, userRole);

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${project.name}*\n` +
            `Client: ${project.client_name || '-'}\n` +
            `Status: ${capitalize(project.status)}\n` +
            `Billable: ${project.billable ? 'Yes' : 'No'}\n`,
        },
        {
          type: 'mrkdwn',
          text:
            `Teams: ${project.teams?.length || '0'} · Users: ${project.users_count}\n` +
            `Created: ${createdAt}\n` +
            `Updated: ${updatedAt}\n` +
            `Description: ${truncate(project.description || '-')}` +
            `\n${archivedAt ? `*Archived:* ${archivedAt}\n` : ''}`,
        },
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

    blocks.push(...Divider.getBlocks());

    return blocks;
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
