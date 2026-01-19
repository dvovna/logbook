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
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { IProjectsListData } from 'src/projects/types/projects-list.types';
import { IProjectListItem } from 'src/projects/types/project-list-item';
import capitalize from '@common/utils/capitalize';

interface IGetProjectsViewParams extends IBaseTabViewParams {
  projectsListData: IProjectsListData;
}

export interface IProjectsTabMetaData {
  page?: number;
  search?: string;
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

  protected getContentBlocks({ projectsListData }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const listBlocks = PaginatedListView.getBlocks<IProjectListItem>({
      itemsData: projectsListData,
      getItemBlocks: (item: IProjectListItem) =>
        this.getProjectListItemBlocks(item),
      prevPageActionId: ProjectsTabViewActionId.PaginationPrev,
      nextPageActionId: ProjectsTabViewActionId.PaginationNext,
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

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${project.name}*\n` +
            `Status: ${capitalize(project.status)}\n` +
            `Billable: ${project.billable ? 'Yes' : 'No'}\n` +
            `Client: ${project.client_name || '-'}\n` +
            `Description: ${truncate(project.description || '-')}\n` +
            `Created: ${createdAt}\n` +
            `Updated: ${updatedAt}`,
        },
      ],
      accessory: {
        type: 'overflow',
        action_id: ProjectsTabViewActionId.ManageProjectMenu,
        options: [
          {
            text: { type: 'plain_text', text: 'Edit Project' },
            value: `${ProjectsTabViewActionId.EditProject}:${project.id}`,
          },
          {
            text: {
              type: 'plain_text',
              text: 'Archive Project',
            },
            value: `${ProjectsTabViewActionId.ArchiveProject}:${project.id}`,
          },
        ],
      },
    });

    blocks.push(...SeparatorComponent.getBlocks());

    return blocks;
  }
}
