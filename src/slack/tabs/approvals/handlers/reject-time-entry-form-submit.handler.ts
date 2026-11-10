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
import { ApprovalsTabService } from '@modules/slack/tabs/approvals/services/approvals-tab.service';
import { TimeEntryNotificationsService } from '@modules/slack/tabs/approvals/services/time-entry-notifications.service';
import { ApprovalsTabModalName } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { IApprovalsTabMetaData } from '@modules/slack/tabs/approvals/views/approvals-tab.view';
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
    private readonly approvalsTabService: ApprovalsTabService,
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
    this.tabNavigationService.navigate(TabId.Approvals, {
      user,
      metadata: meta.pageMetadata
        ? (JSON.parse(meta.pageMetadata) as IApprovalsTabMetaData)
        : {},
      notice: `❌ Rejected. ${entry.user?.name ?? 'Its owner'} gets a message about it.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IRejectReasonFormViewData,
    meta: IRejectWithReasonModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.approvalsTabService.getModalView(
        ApprovalsTabModalName.RejectEntry,
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
