import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import * as pluralize from 'pluralize';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { TimeApprovalsTabModalName } from '@modules/slack/tabs/time-approvals/enums/time-approvals-tab-action-id.enum';
import {
  ITimeApprovalsTabMetaData,
  TIME_APPROVALS_PAGE_SIZE,
  TimeApprovalsTabView,
} from '@modules/slack/tabs/time-approvals/views/time-approvals-tab.view';
import { RejectWithReasonModalView } from '@modules/slack/common/views/components/reject-with-reason-modal.view';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';

interface IRejectModalParams extends IOpenModalBaseParams<string> {
  entryId: string;
}

type TimeApprovalsTabModalViewResolversMap = {
  [TimeApprovalsTabModalName.RejectEntry]: (
    params: IRejectModalParams,
  ) => Promise<View>;
  [TimeApprovalsTabModalName.ApproveAll]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
};

interface IGetTimeApprovalsTabViewParams extends IPublishBaseParams {
  metadata?: ITimeApprovalsTabMetaData;
}

@Injectable()
export class TimeApprovalsTabService extends BaseTabService<TimeApprovalsTabModalViewResolversMap> {
  public constructor(
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly timeApprovalsTabView: TimeApprovalsTabView,
    private readonly rejectWithReasonModalView: RejectWithReasonModalView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.TimeApprovals, {
      [TimeApprovalsTabModalName.RejectEntry]: async (params) =>
        this.getRejectModal(params),
      [TimeApprovalsTabModalName.ApproveAll]: (params) =>
        this.getApproveAllModal(params),
    });
  }

  public async getTabView({
    user,
    metadata = {},
  }: IGetTimeApprovalsTabViewParams) {
    const pendingEntries = await this.timeEntryApprovalsService.listPending(
      user,
      { page: metadata.page, pageSize: TIME_APPROVALS_PAGE_SIZE },
    );

    return this.timeApprovalsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        pendingEntries,
      },
      metadata,
    );
  }

  private getRejectModal({
    entryId,
    errorMessage,
    pageMetadata,
  }: IRejectModalParams) {
    return this.rejectWithReasonModalView.getView(
      {
        callbackId: ViewCallbackId.RejectTimeEntry,
        title: 'Reject Time Entry',
        hint: 'Sent to the person along with the entry, so they can fix it.',
        errorMessage,
      },
      { id: entryId, pageMetadata },
    );
  }

  private async getApproveAllModal({
    user,
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    const count = await this.timeEntryApprovalsService.countPending(user);

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.ApproveAllTimeEntries,
        title: 'Approve Time Entries',
        message: `${pluralize('time entry', count, true)} waiting for you will be approved.`,
        errorMessage,
      },
      { id: '', pageMetadata },
    );
  }
}
