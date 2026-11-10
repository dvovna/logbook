import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import pluralize from 'pluralize';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { ApprovalsTabModalName } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import {
  IApprovalsTabMetaData,
  TIME_APPROVALS_PAGE_SIZE,
  TIME_OFF_SHOWN,
  ApprovalsTabView,
} from '@modules/slack/tabs/approvals/views/approvals-tab.view';
import { RejectWithReasonModalView } from '@modules/slack/common/views/components/reject-with-reason-modal.view';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { VacationDetailsModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';
import { ApproverStepCommentModalView } from '@modules/slack/approvals/views/approver-step-comment-modal.view';
import { RejectStepModalView } from '@modules/slack/approvals/views/reject-step-modal.view';
import { REQUEST_CONFIRMATION_VIEW_CONFIG } from '@modules/slack/approvals/configs/request-confirmation-view-config';

interface IRejectModalParams extends IOpenModalBaseParams<string> {
  entryId: string;
}

interface IStepModalParams extends IOpenModalBaseParams {
  stepId: string;
}

interface IRequestModalParams extends IOpenModalBaseParams {
  requestId: string;
}

type ApprovalsTabModalViewResolversMap = {
  [ApprovalsTabModalName.ApproveTimeOff]: (params: IStepModalParams) => View;
  [ApprovalsTabModalName.RejectTimeOff]: (
    params: IStepModalParams,
  ) => Promise<View>;
  [ApprovalsTabModalName.CommentTimeOff]: (params: IStepModalParams) => View;
  [ApprovalsTabModalName.TimeOffDetails]: (
    params: IRequestModalParams,
  ) => Promise<View>;
  [ApprovalsTabModalName.RejectEntry]: (
    params: IRejectModalParams,
  ) => Promise<View>;
  [ApprovalsTabModalName.ApproveAll]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
};

interface IGetApprovalsTabViewParams extends IPublishBaseParams {
  metadata?: IApprovalsTabMetaData;
}

// The Approvals inbox: time off requests and time entries that wait for the
// viewer's decision.
@Injectable()
export class ApprovalsTabService extends BaseTabService<ApprovalsTabModalViewResolversMap> {
  public constructor(
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly approvalsTabView: ApprovalsTabView,
    private readonly rejectWithReasonModalView: RejectWithReasonModalView,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly approverStepCommentModalView: ApproverStepCommentModalView,
    private readonly rejectStepModalView: RejectStepModalView,
  ) {
    super(TabId.Approvals, {
      [ApprovalsTabModalName.ApproveTimeOff]: ({ stepId, errorMessage }) =>
        this.confirmationModalView.getView(
          { ...REQUEST_CONFIRMATION_VIEW_CONFIG.approve, errorMessage },
          { id: stepId },
        ),
      [ApprovalsTabModalName.RejectTimeOff]: ({ stepId, errorMessage, user }) =>
        this.rejectStepModalView.getView(stepId, user, {
          pageMetadata: '{}',
          errorMessage,
        }),
      [ApprovalsTabModalName.CommentTimeOff]: ({ stepId }) =>
        this.approverStepCommentModalView.getView({}, { stepId }),
      [ApprovalsTabModalName.TimeOffDetails]: (params) =>
        this.vacationDetailsModalService.getModal(params),
      [ApprovalsTabModalName.RejectEntry]: async (params) =>
        this.getRejectModal(params),
      [ApprovalsTabModalName.ApproveAll]: (params) =>
        this.getApproveAllModal(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetApprovalsTabViewParams) {
    const [waiting, pendingEntries] = await Promise.all([
      this.requestWorkflowStepsService.findWaitingFor(user),
      this.timeEntryApprovalsService.listPending(user, {
        page: metadata.page,
        pageSize: TIME_APPROVALS_PAGE_SIZE,
      }),
    ]);

    const timeOff = {
      items: waiting.slice(0, TIME_OFF_SHOWN),
      totalCount: waiting.length,
      page: 1,
      pageSize: TIME_OFF_SHOWN,
    };

    return this.approvalsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        timeOff,
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
