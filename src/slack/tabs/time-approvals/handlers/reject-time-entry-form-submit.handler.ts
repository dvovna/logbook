import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import RejectReasonModalViewValuesParser, {
  IRejectReasonFormViewData,
} from '@modules/slack/common/parsers/reject-reason-modal-view-values.parser';
import {
  IRejectWithReasonModalViewMetadata,
  RejectWithReasonModalView,
} from '@modules/slack/common/views/components/reject-with-reason-modal.view';
import { TimeApprovalsTabService } from '@modules/slack/tabs/time-approvals/services/time-approvals-tab.service';
import { TimeEntryNotificationsService } from '@modules/slack/tabs/time-approvals/services/time-entry-notifications.service';
import { TimeApprovalsTabModalName } from '@modules/slack/tabs/time-approvals/enums/time-approvals-tab-action-id.enum';
import { ITimeApprovalsTabMetaData } from '@modules/slack/tabs/time-approvals/views/time-approvals-tab.view';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// Rejects the entry and tells its owner why, after Slack has its answer.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.RejectTimeEntry,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class RejectTimeEntryFormSubmitHandler extends BaseModalFormSubmitHandler<
  IRejectWithReasonModalViewMetadata,
  IRejectReasonFormViewData,
  ITimeEntryViewModel
> {
  public constructor(
    private readonly rejectWithReasonModalView: RejectWithReasonModalView,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly timeEntryNotificationsService: TimeEntryNotificationsService,
    private readonly timeApprovalsTabService: TimeApprovalsTabService,
    private readonly tabNavigationService: TabNavigationService,
    formParser: RejectReasonModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    data: IRejectReasonFormViewData,
    meta: IRejectWithReasonModalViewMetadata,
    user: IUserViewModel,
  ) {
    const entry = await this.timeEntryApprovalsService.reject(
      user,
      meta.id,
      data.reason,
    );

    this.timeEntryNotificationsService.notifyRejected(entry, user, data.reason);

    return entry;
  }

  protected successResponse(
    entry: ITimeEntryViewModel,
    user: IUserViewModel,
    meta: IRejectWithReasonModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.TimeApprovals, {
      user,
      metadata: meta.pageMetadata
        ? (JSON.parse(meta.pageMetadata) as ITimeApprovalsTabMetaData)
        : {},
    });

    return SlackViewResponseFactory.update(
      this.rejectWithReasonModalView.getSuccessView(
        `The time entry has been rejected. ${entry.user?.name ?? 'Its owner'} will get a message about it.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IRejectReasonFormViewData,
    meta: IRejectWithReasonModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeApprovalsTabService.getModalView(
        TimeApprovalsTabModalName.RejectEntry,
        {
          user,
          entryId: meta.id,
          errorMessage,
          pageMetadata: meta.pageMetadata ?? '',
        },
      ),
    );
  }
}
