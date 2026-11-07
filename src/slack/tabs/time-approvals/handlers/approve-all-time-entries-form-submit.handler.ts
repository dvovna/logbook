import { Injectable } from '@nestjs/common';
import * as pluralize from 'pluralize';
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
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { TimeApprovalsTabService } from '@modules/slack/tabs/time-approvals/services/time-approvals-tab.service';
import { TimeApprovalsTabModalName } from '@modules/slack/tabs/time-approvals/enums/time-approvals-tab-action-id.enum';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// The confirmation behind "Approve all": approves every entry waiting for
// the user, not only the page they see.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApproveAllTimeEntries,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class ApproveAllTimeEntriesFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  ITimeEntryViewModel[]
> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly timeApprovalsTabService: TimeApprovalsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected onSubmit(
    _data: never,
    _meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.timeEntryApprovalsService.approve(user);
  }

  protected successResponse(
    entries: ITimeEntryViewModel[],
    user: IUserViewModel,
  ) {
    this.tabNavigationService.navigate(TabId.TimeApprovals, {
      user,
      metadata: {},
      notice: `✅ ${pluralize('time entry', entries.length, true)} approved.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeApprovalsTabService.getModalView(
        TimeApprovalsTabModalName.ApproveAll,
        { user, errorMessage, pageMetadata: meta.pageMetadata ?? '' },
      ),
    );
  }
}
