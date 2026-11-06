import { Injectable, Logger } from '@nestjs/common';
import {
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import {
  withPagination,
} from '@modules/slack/common/utils/tab-list.utils';
import {
  TimeEntriesTabService,
} from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import {
  TimeEntriesTabViewActionId,
} from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeEntriesTabView,
  type: 'block_actions',
})
export default class TimeEntriesTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(TimeEntriesTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly timeEntriesTabService: TimeEntriesTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [TimeEntriesTabViewActionId.AddTimeEntry]: this.handleAddEntry,
      // [ProjectsTabViewActionId.ManageProjectMenu]: withMenuAction<
      //   ProjectsTabViewActionId,
      //   [IUserViewModel]
      // >(this.handleManageProjectMenuAction, this.logger),
      // [ProjectsTabViewActionId.PaginationPrev]: paginationHandler,
      // [ProjectsTabViewActionId.PaginationNext]: paginationHandler,
      // [ProjectsTabViewActionId.FindProjectByName]: withAsyncSelectFilter(
      //   'project',
      //   this.updateTab,
      // ),
      // [ProjectsTabViewActionId.FilterByStatus]: withSelectFilter(
      //   'status',
      //   this.updateTab,
      // ),
      // [ProjectsTabViewActionId.FilterByBillable]: withSelectFilter(
      //   'billable',
      //   this.updateTab,
      // ),
      // [ProjectsTabViewActionId.IncludeArchivedProjects]: this.handleIncludeArchivedProjectsFilter,
      // [ProjectsTabViewActionId.ResetFilters]: withResetFilters(this.updateTab),
    };
  }

  private updateTab = async (
    metadata: ITimeEntriesTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.timeEntriesTabService.publish({
      user,
      metadata,
    });
  };

  private handleAddEntry = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.timeEntriesTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeEntriesTabModalName.CreateTimeEntry,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  // private handleIncludeArchivedProjectsFilter = async (
  //   payload: ISlackBlockActionPayload,
  //   user: IUserViewModel,
  // ) => {
  //   const values = getCheckboxActionValues(payload);
  //   const metadata = parseMetadata<IProjectsTabMetaData>(payload);
  //
  //   const updatedMetadata: IProjectsTabMetaData = {
  //     ...metadata,
  //     includeArchived: values[0] === YesNoValue.Yes,
  //   };
  //
  //   await this.updateTab(updatedMetadata, user);
  // };
  //
  // private handleManageProjectMenuAction = async (
  //   actionType: ProjectsTabViewActionId,
  //   projectId: string,
  //   payload: ISlackInteractionPayload,
  //   user: IUserViewModel,
  // ) => {
  //   switch (actionType) {
  //     case ProjectsTabViewActionId.EditProject: {
  //       await this.projectsTabService.openModal(
  //         payload.trigger_id || user.slack_id,
  //         ProjectsTabModalName.UpdateProject,
  //         { user, projectId, pageMetadata: payload.view.private_metadata },
  //       );
  //
  //       break;
  //     }
  //     case ProjectsTabViewActionId.ArchiveProject: {
  //       await this.projectsTabService.openModal(
  //         payload.trigger_id || user.slack_id,
  //         ProjectsTabModalName.ChangeProjectStatus,
  //         { user, projectId, pageMetadata: payload.view.private_metadata },
  //       );
  //
  //       break;
  //     }
  //     case ProjectsTabViewActionId.ManageProjectAssignments: {
  //       await this.projectsTabService.openModal(
  //         payload.trigger_id || user.slack_id,
  //         ProjectsTabModalName.ManageProjectAssignments,
  //         { user, projectId, pageMetadata: payload.view.private_metadata },
  //       );
  //
  //       break;
  //     }
  //     default: {
  //       this.logger.warn(`Unhandled Tab Menu actionType: ${actionType}`);
  //     }
  //   }
  // };
}
