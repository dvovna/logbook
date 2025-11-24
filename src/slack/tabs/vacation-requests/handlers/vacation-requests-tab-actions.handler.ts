import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  IVacationRequestsTabMetadata,
  VacationRequestsTabViewActionId,
} from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import {
  VacationRequestsTabModalName,
  VacationRequestsTabService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import {
  withSelectFilter,
  withPagination,
  withAsyncSelectFilter,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationRequestsTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class VacationRequestsTabActionsHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(VacationRequestsTabActionsHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    protected readonly vacationRequestsTabService: VacationRequestsTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [VacationRequestsTabViewActionId.CreateRequest]: this.handleCreateRequest,
      [VacationRequestsTabViewActionId.ManageRequestMenu]: withMenuAction<
        VacationRequestsTabViewActionId,
        [IUserViewModel]
      >(this.handleManageRequestMenuAction, this.logger),
      [VacationRequestsTabViewActionId.PaginationPrev]: paginationHandler,
      [VacationRequestsTabViewActionId.PaginationNext]: paginationHandler,
      [VacationRequestsTabViewActionId.FilterRequestsByStatus]:
        withSelectFilter('status', this.updateTab),
      [VacationRequestsTabViewActionId.FilterRequestsByTeam]: withSelectFilter(
        'teamId',
        this.updateTab,
      ),
      [VacationRequestsTabViewActionId.FilterRequestsByYear]: withSelectFilter(
        'year',
        this.updateTab,
      ),
      [VacationRequestsTabViewActionId.FilterRequestsByType]: withSelectFilter(
        'type',
        this.updateTab,
      ),
      [VacationRequestsTabViewActionId.FilterRequestsByUser]:
        withAsyncSelectFilter('user', this.updateTab),
    };
  }

  private handleCreateRequest = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.vacationRequestsTabService.openModal(
      payload.trigger_id || user.slack_id,
      VacationRequestsTabModalName.CreateRequest,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private updateTab = async (
    metadata: IVacationRequestsTabMetadata,
    user: IUserViewModel,
  ) => {
    await this.vacationRequestsTabService.publish({
      user,
      metadata,
    });
  };

  private handleManageRequestMenuAction = async (
    actionType: VacationRequestsTabViewActionId,
    requestId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case VacationRequestsTabViewActionId.ViewDetails: {
        await this.vacationRequestsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationRequestsTabModalName.ViewRequest,
          {
            user,
            requestId,
            pageMetadata: payload.view.private_metadata,
          },
        );

        break;
      }
      case VacationRequestsTabViewActionId.EditRequest: {
        await this.vacationRequestsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationRequestsTabModalName.UpdateRequest,
          { user, requestId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case VacationRequestsTabViewActionId.DeleteRequest: {
        await this.vacationRequestsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationRequestsTabModalName.DeleteRequest,
          { user, requestId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(
          `Unhandled Vacation Request Menu actionType: ${actionType}`,
        );
      }
    }
  };
}
