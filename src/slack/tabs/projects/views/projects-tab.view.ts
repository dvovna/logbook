import { Injectable } from '@nestjs/common';
import { truncate } from 'lodash';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { IProjectsListData } from 'src/projects/types/projects-list.types';
import { IProjectListItem } from 'src/projects/types/project-list-item.types';
import capitalize from '@common/utils/capitalize';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { ProjectStatusDisplayNameMap } from 'src/projects/static/project-status-display-name.map';
import { IProjectTabFilters } from '@modules/slack/tabs/projects/services/projects-tab.service';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

interface IGetProjectsViewParams extends IBaseTabViewParams {
  projectsListData: IProjectsListData;
}

export interface IProjectsTabMetaData {
  page?: number;
  filters?: IProjectTabFilters;
}

const BILLABLE_PLAIN_TEXT_OPTIONS: PlainTextOption[] = [{
  text: { type: 'plain_text', text: 'Yes' },
  value: YesNoValue.Yes,
}, {
  text: { type: 'plain_text', text: 'No' },
  value: YesNoValue.No,
}];

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

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Project' },
      action_id: ProjectsTabViewActionId.AddProject,
    };
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManageTimeAndBilling);
  }

  protected getContentBlocks({ projectsListData }, { filters }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push(...this.getFiltersBlocks(filters));

    const listBlocks = PaginatedListView.getBlocks<IProjectListItem>({
      itemsData: projectsListData,
      getItemBlocks: (item: IProjectListItem) =>
        this.getProjectListItemBlocks(item),
      prevPageActionId: ProjectsTabViewActionId.PaginationPrev,
      nextPageActionId: ProjectsTabViewActionId.PaginationNext,
      emptyText: '_No projects found_',
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getProjectListItemBlocks(
    project: IProjectListItem,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const updatedAt = new Date(project.updated_at).toLocaleDateString();
    const createdAt = new Date(project.created_at).toLocaleDateString();
    const archivedAt = project.archived_at
      && new Date(project.archived_at).toLocaleDateString();

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
          text: `Teams: ${project.teams?.length || '0'} · Users: ${project.users_count}\n` +
            `Created: ${createdAt}\n` +
            `Updated: ${updatedAt}\n` +
            `Description: ${truncate(project.description || '-')}` +
            `\n${archivedAt ? `*Archived:* ${archivedAt}\n` : ''}`,
        },
      ],
      accessory: {
        type: 'overflow',
        action_id: ProjectsTabViewActionId.ManageProjectMenu,
        options: [
          ...(!project.archived_at ? [{
            text: { type: 'plain_text', text: 'Edit Project' },
            value: `${ProjectsTabViewActionId.EditProject}:${project.id}`,
          },
          {
            text: { type: 'plain_text', text: 'Manage Assignments' },
            value: `${ProjectsTabViewActionId.ManageProjectAssignments}:${project.id}`,
          }] as const : []),
          {
            text: {
              type: 'plain_text',
              text: `${project.archived_at ? 'Restore' : 'Archive'} Project`,
            },
            value: `${ProjectsTabViewActionId.ArchiveProject}:${project.id}`,
          },
        ],
      },
    });

    blocks.push(...SeparatorComponent.getBlocks());

    return blocks;
  }

  private getFiltersBlocks(filters?: IProjectTabFilters): AnyBlock[] {
    const projectStatusOptions = Object.values(ProjectStatus).map((status) =>
      toPlainTextOption({
        id: status,
        name: ProjectStatusDisplayNameMap[status],
      }),
    );
    const selectedProjectStatusOption = projectStatusOptions.find(
      ({ value }) => value === filters?.status,
    );

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Filters*',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'external_select',
            action_id: ProjectsTabViewActionId.FindProjectByName,
            placeholder: {
              type: 'plain_text',
              text: 'Find Project',
            },
            min_query_length: 2,
            initial_option: filters?.project && {
              text: {
                type: 'plain_text',
                text: filters.project.name,
              },
              value: filters.project.value,
            },
          },
          {
            type: 'static_select',
            action_id: ProjectsTabViewActionId.FilterByStatus,
            placeholder: {
              type: 'plain_text',
              text: 'Status',
            },
            initial_option: selectedProjectStatusOption,
            options: projectStatusOptions,
          },
          {
            type: 'static_select',
            action_id: ProjectsTabViewActionId.FilterByBillable,
            placeholder: {
              type: 'plain_text',
              text: 'Billable',
            },
            initial_option: BILLABLE_PLAIN_TEXT_OPTIONS.find(
              ({ value }) => value === filters?.billable,
            ),
            options: BILLABLE_PLAIN_TEXT_OPTIONS,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Reset',
            },
            action_id: ProjectsTabViewActionId.ResetFilters,
          },
          {
            type: 'checkboxes',
            action_id: ProjectsTabViewActionId.IncludeArchivedProjects,
            options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Include archived projects',
                },
                value: YesNoValue.Yes,
              },
            ],
            initial_options: filters?.includeArchived?.includes(YesNoValue.Yes) ? [{
              text: {
                type: 'plain_text',
                text: 'Include archived projects',
              },
              value: YesNoValue.Yes,
            }] : undefined,
          },
        ],
      },
      ...SeparatorComponent.getBlocks(),
    ];
  }
}
