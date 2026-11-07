import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ButtonAction } from '@slack/bolt';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
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
import { withPagination } from '@modules/slack/common/utils/tab-list.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import {
  TimeApprovalsTabActionId,
  TimeApprovalsTabModalName,
} from '@modules/slack/tabs/time-approvals/enums/time-approvals-tab-action-id.enum';
import { TimeApprovalsTabService } from '@modules/slack/tabs/time-approvals/services/time-approvals-tab.service';
import { ITimeApprovalsTabMetaData } from '@modules/slack/tabs/time-approvals/views/time-approvals-tab.view';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeApprovalsTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class TimeApprovalsTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(TimeApprovalsTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly timeApprovalsTabService: TimeApprovalsTabService,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [TimeApprovalsTabActionId.ApproveEntry]: this.handleApprove,
      [TimeApprovalsTabActionId.RejectEntry]: this.handleReject,
      [TimeApprovalsTabActionId.ApproveAll]: this.handleApproveAll,
      [TimeApprovalsTabActionId.PaginationPrev]: paginationHandler,
      [TimeApprovalsTabActionId.PaginationNext]: paginationHandler,
    };
  }

  private updateTab = async (
    metadata: ITimeApprovalsTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.timeApprovalsTabService.publish({ user, metadata });
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
      if (
        !(
          error instanceof ValidationError ||
          error instanceof ForbiddenException
        )
      ) {
        throw error;
      }

      this.logger.warn(`Time entry not approved: ${error.message}`);
    }

    await this.updateTab(
      parseMetadata<ITimeApprovalsTabMetaData>(payload),
      user,
    );
  };

  private handleReject = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    await this.timeApprovalsTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeApprovalsTabModalName.RejectEntry,
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
    await this.timeApprovalsTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeApprovalsTabModalName.ApproveAll,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private entryIdOf(payload: ISlackBlockActionPayload) {
    return (payload.actions[0] as ButtonAction).value!;
  }
}
