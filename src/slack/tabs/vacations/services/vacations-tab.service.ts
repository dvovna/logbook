import { RejectStepModalView } from '@modules/slack/approvals/views/reject-step-modal.view';
import { Injectable } from '@nestjs/common';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { VacationsTabView } from '@modules/slack/tabs/vacations/views/vacations-tab.view';
import { VacationsTabModalName } from '@modules/slack/tabs/vacations/enums/vacations-tab-modal-name.enum';
import { VacationDetailsModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';
import { View } from '@slack/types/dist/views';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import TeamsService from '@modules/teams/services/teams.service';
import { ApproverStepCommentModalView } from '@modules/slack/approvals/views/approver-step-comment-modal.view';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { REQUEST_CONFIRMATION_VIEW_CONFIG } from '@modules/slack/approvals/configs/request-confirmation-view-config';

export type IGetVacationsTabViewParams = IPublishBaseParams;

interface IRequestModalParams extends IOpenModalBaseParams {
  requestId: string;
}

interface IPendingRequestModalParams extends IOpenModalBaseParams {
  stepId: string;
}

type VacationsTabModalViewResolversMapType = {
  [VacationsTabModalName.ViewPendingRequest]: (
    params: IRequestModalParams,
  ) => Promise<View>;
  [VacationsTabModalName.ApprovePendingRequest]: (
    params: IPendingRequestModalParams,
  ) => Promise<View>;
  [VacationsTabModalName.RejectPendingRequest]: (
    params: IPendingRequestModalParams,
  ) => Promise<View>;
  [VacationsTabModalName.CommentPendingRequest]: (
    params: IPendingRequestModalParams,
  ) => Promise<View>;
};

const MAX_ITEMS_PER_TAB = 5;

@Injectable()
export class VacationsTabService extends BaseTabService<VacationsTabModalViewResolversMapType> {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly teamsService: TeamsService,
    private readonly vacationsViewService: VacationsTabView,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly approverStepCommentModalView: ApproverStepCommentModalView,
    private readonly rejectStepModalView: RejectStepModalView,
  ) {
    super(TabId.Vacations, {
      [VacationsTabModalName.ViewPendingRequest]: (params) =>
        this.getViewVacationRequestModal(params),
      [VacationsTabModalName.ApprovePendingRequest]: async (params) =>
        this.getApproveVacationRequestModal(params),
      [VacationsTabModalName.RejectPendingRequest]: async (params) =>
        this.getRejectVacationRequestModal(params),
      [VacationsTabModalName.CommentPendingRequest]: async (params) =>
        this.getCommentVacationRequestModal(params),
    });
  }

  protected async getTabView(params: IGetVacationsTabViewParams) {
    const { totalCount: pendingRequestsCount, items: pendingRequests } =
      await this.requestWorkflowStepsService.search({
        filters: {
          slackUserId: params.user.slack_id,
          slackTeamId: params.user.slack_team_id,
          processed: true,
          completed: false,
        },
        pageSize: MAX_ITEMS_PER_TAB,
        orderBy: ['created_at:desc'],
      });

    // Admin and HR see everyone's vacations, a manager their teams' only.
    const teamIds = await this.teamsService.findManagedTeamIds(params.user);
    const { items: upcomingVacations } =
      await this.vacationRequestsService.search({
        filters: {
          slackTeamId: params.user.slack_team_id,
          ...(teamIds ? { teamIds } : {}),
          statuses: [VacationRequestStatus.Approved],
          startDate: new Date().toUTCString(),
        },
        pageSize: MAX_ITEMS_PER_TAB,
        orderBy: ['start_date:asc', 'created_at:desc'],
      });

    return this.vacationsViewService.getView({
      userId: params.user.slack_id,
      userRole: params.user.role,
      pendingRequestsCount,
      pendingRequests,
      upcomingVacations,
    });
  }

  private getViewVacationRequestModal(params: IRequestModalParams) {
    return this.vacationDetailsModalService.getModal(params);
  }

  private getApproveVacationRequestModal(params: IPendingRequestModalParams) {
    const { stepId, errorMessage } = params;

    return this.confirmationModalView.getView(
      {
        ...REQUEST_CONFIRMATION_VIEW_CONFIG.approve,
        errorMessage,
      },
      { id: stepId },
    );
  }

  private getRejectVacationRequestModal(params: IPendingRequestModalParams) {
    const { stepId, errorMessage, user } = params;

    return this.rejectStepModalView.getView(stepId, user, {
      pageMetadata: '{}',
      errorMessage,
    });
  }

  private getCommentVacationRequestModal(params: IPendingRequestModalParams) {
    return this.approverStepCommentModalView.getView(
      {},
      { stepId: params.stepId },
    );
  }
}
