import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { runInBackground } from '@common/utils/run-in-background';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import RejectTimeEntryModalViewValuesParser, {
  IRejectTimeEntryFormViewData,
} from '@modules/slack/tabs/time-approvals/parsers/reject-time-entry-modal-view-values.parser';
import {
  IRejectTimeEntryModalViewMetadata,
  RejectTimeEntryModalView,
} from '@modules/slack/tabs/time-approvals/views/reject-time-entry-modal.view';
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
  IRejectTimeEntryModalViewMetadata,
  IRejectTimeEntryFormViewData,
  ITimeEntryViewModel
> {
  public constructor(
    private readonly rejectTimeEntryModalView: RejectTimeEntryModalView,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly timeEntryNotificationsService: TimeEntryNotificationsService,
    private readonly timeApprovalsTabService: TimeApprovalsTabService,
    private readonly tabNavigationService: TabNavigationService,
    formParser: RejectTimeEntryModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    data: IRejectTimeEntryFormViewData,
    meta: IRejectTimeEntryModalViewMetadata,
    user: IUserViewModel,
  ) {
    const entry = await this.timeEntryApprovalsService.reject(user, meta.id);

    runInBackground(
      this.logger,
      `notify about rejected time entry ${entry.id}`,
      () =>
        this.timeEntryNotificationsService.notifyRejected(
          entry,
          user,
          data.reason,
        ),
    );

    return entry;
  }

  protected successResponse(
    entry: ITimeEntryViewModel,
    user: IUserViewModel,
    meta: IRejectTimeEntryModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.TimeApprovals, {
      user,
      metadata: meta.pageMetadata
        ? (JSON.parse(meta.pageMetadata) as ITimeApprovalsTabMetaData)
        : {},
    });

    return SlackViewResponseFactory.update(
      this.rejectTimeEntryModalView.getSuccessView(
        `The time entry has been rejected. ${entry.user?.name ?? 'Its owner'} will get a message about it.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IRejectTimeEntryFormViewData,
    meta: IRejectTimeEntryModalViewMetadata,
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
