import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { ButtonAction } from '@slack/bolt';
import { ValidationError } from '@common/errors/validation.error';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { withPagination } from '@modules/slack/common/utils/tab-list.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import {
  ApprovalsTabActionId,
  ApprovalsTabModalName,
} from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { ApprovalsTabService } from '@modules/slack/tabs/approvals/services/approvals-tab.service';
import { IApprovalsTabMetaData } from '@modules/slack/tabs/approvals/views/approvals-tab.view';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApprovalsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Approvals),
})
export default class ApprovalsTabActionHandler extends BaseTabActionHandler {
  private readonly logger = new Logger(ApprovalsTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly approvalsTabService: ApprovalsTabService,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [ApprovalsTabActionId.ApproveTimeOff]: (payload, user) =>
        this.openStepModal(ApprovalsTabModalName.ApproveTimeOff, payload, user),
      [ApprovalsTabActionId.RejectTimeOff]: (payload, user) =>
        this.openStepModal(ApprovalsTabModalName.RejectTimeOff, payload, user),
      [ApprovalsTabActionId.TimeOffMenu]: withMenuAction(
        this.handleTimeOffMenu,
        this.logger,
      ),
      [ApprovalsTabActionId.AllPendingTimeOff]: this.handleAllPendingTimeOff,
      [ApprovalsTabActionId.ApproveEntry]: this.handleApprove,
      [ApprovalsTabActionId.RejectEntry]: this.handleReject,
      [ApprovalsTabActionId.ApproveAll]: this.handleApproveAll,
      [ApprovalsTabActionId.ShowAllEntries]: (payload, user) =>
        this.showEntries(payload, user, true),
      [ApprovalsTabActionId.ShowWaitingEntries]: (payload, user) =>
        this.showEntries(payload, user, false),
      [ApprovalsTabActionId.PaginationPrev]: paginationHandler,
      [ApprovalsTabActionId.PaginationNext]: paginationHandler,
    };
  }

  // Admin and HR switch between what waits for them and every submitted
  // entry; for anyone else the service lists what waits for them anyway.
  private showEntries(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
    allEntries: boolean,
  ) {
    return this.updateTab(
      { ...parseMetadata<IApprovalsTabMetaData>(payload), allEntries, page: 1 },
      user,
    );
  }

  private updateTab = async (
    metadata: IApprovalsTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.approvalsTabService.publish({ user, metadata });
  };

  // The step is checked when the form is sent (assertCanActOnStep).
  private openStepModal = async (
    modalName:
      | ApprovalsTabModalName.ApproveTimeOff
      | ApprovalsTabModalName.RejectTimeOff,
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    await this.approvalsTabService.openModal(
      payload.trigger_id || user.slack_id,
      modalName,
      { user, stepId: this.entryIdOf(payload) },
    );
  };

  private handleTimeOffMenu = async (
    actionType: ApprovalsTabActionId,
    id: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const triggerId = payload.trigger_id || user.slack_id;

    switch (actionType) {
      case ApprovalsTabActionId.CommentTimeOff:
        return this.approvalsTabService.openModal(
          triggerId,
          ApprovalsTabModalName.CommentTimeOff,
          { user, stepId: id },
        );
      case ApprovalsTabActionId.TimeOffDetails:
        return this.approvalsTabService.openModal(
          triggerId,
          ApprovalsTabModalName.TimeOffDetails,
          { user, requestId: id },
        );
      default:
        this.logger.warn(`Unhandled time off menu action: ${actionType}`);
    }
  };

  // Every pending request HR and admins can see, with Approve for Approvers.
  private handleAllPendingTimeOff = (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    this.tabNavigationService.navigate(TabId.VacationRequests, {
      user,
      metadata: { filters: { status: VacationRequestStatus.Pending } },
    });
  };

  // An entry someone else decided on in the meantime just leaves the list.
  private handleApprove = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    try {
      await this.timeEntryApprovalsService.approve(
        user,
        this.entryIdOf(payload),
      );
    } catch (error) {
      if (!(
        error instanceof ValidationError || error instanceof ForbiddenException
      )) {
        throw error;
      }

      this.logger.warn(`Time entry not approved: ${error.message}`);
    }

    await this.updateTab(parseMetadata<IApprovalsTabMetaData>(payload), user);
  };

  private handleReject = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    await this.approvalsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ApprovalsTabModalName.RejectEntry,
      {
        user,
        entryId: this.entryIdOf(payload),
        pageMetadata: payload.view.private_metadata,
      },
    );
  };

  private handleApproveAll = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.approvalsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ApprovalsTabModalName.ApproveAll,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private entryIdOf(payload: ISlackBlockActionPayload) {
    return (payload.actions[0] as ButtonAction).value!;
  }
}
