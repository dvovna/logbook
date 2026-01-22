import { Injectable, Logger } from '@nestjs/common';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import {
  withAsyncSelectFilter,
  withPagination,
  withResetFilters,
  withSelectFilter,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { ProjectsTabModalName, ProjectsTabService } from '@modules/slack/tabs/projects/services/projects-tab.service';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { IProjectsTabMetaData } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { getCheckboxActionValues } from '@modules/slack/common/utils/payload.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ProjectsTabView,
  type: 'block_actions',
})
export default class ProjectsTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(ProjectsTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly projectsTabService: ProjectsTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [ProjectsTabViewActionId.AddProject]: this.handleAddProject,
      [ProjectsTabViewActionId.ManageProjectMenu]: withMenuAction<
        ProjectsTabViewActionId,
        [IUserViewModel]
      >(this.handleManageProjectMenuAction, this.logger),
      [ProjectsTabViewActionId.PaginationPrev]: paginationHandler,
      [ProjectsTabViewActionId.PaginationNext]: paginationHandler,
      [ProjectsTabViewActionId.FindProjectByName]: withAsyncSelectFilter(
        'project',
        this.updateTab,
      ),
      [ProjectsTabViewActionId.FilterByStatus]: withSelectFilter(
        'status',
        this.updateTab,
      ),
      [ProjectsTabViewActionId.FilterByBillable]: withSelectFilter(
        'billable',
        this.updateTab,
      ),
      [ProjectsTabViewActionId.IncludeArchivedProjects]: this.handleIncludeArchivedProjectsFilter,
      [ProjectsTabViewActionId.ResetFilters]: withResetFilters(this.updateTab),
    };
  }

  private updateTab = async (
    metadata: IProjectsTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.projectsTabService.publish({
      user,
      metadata,
    });
  };

  private handleAddProject = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.projectsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ProjectsTabModalName.CreateProject,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleIncludeArchivedProjectsFilter = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const values = getCheckboxActionValues(payload);
    const metadata = parseMetadata<IProjectsTabMetaData>(payload);

    const updatedMetadata: IProjectsTabMetaData = {
      ...metadata,
      includeArchived: values[0] === YesNoValue.Yes,
    };

    await this.updateTab(updatedMetadata, user);
  };

  private handleManageProjectMenuAction = async (
    actionType: ProjectsTabViewActionId,
    projectId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case ProjectsTabViewActionId.EditProject: {
        await this.projectsTabService.openModal(
          payload.trigger_id || user.slack_id,
          ProjectsTabModalName.UpdateProject,
          { user, projectId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case ProjectsTabViewActionId.ArchiveProject: {
        await this.projectsTabService.openModal(
          payload.trigger_id || user.slack_id,
          ProjectsTabModalName.ChangeProjectStatus,
          { user, projectId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case ProjectsTabViewActionId.ManageProjectAssignments: {
        await this.projectsTabService.openModal(
          payload.trigger_id || user.slack_id,
          ProjectsTabModalName.ManageProjectAssignments,
          { user, projectId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
