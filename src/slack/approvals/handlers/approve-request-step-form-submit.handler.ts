import { WorkflowDecisionsService } from '@modules/request-workflows/services/workflow-decisions.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { WorkflowStepStatus } from '@modules/request-workflows/types/request-workflow-step.interface';
import { decisionNotice } from '@modules/slack/approvals/utils/decision-notice';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import UserRole from '@common/enums/user-role.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { REQUEST_CONFIRMATION_VIEW_CONFIG } from '@modules/slack/approvals/configs/request-confirmation-view-config';
import { runInBackground } from '@common/utils/run-in-background';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApproveRequestStepMessage,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class ApproveRequestStepFormSubmitHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  constructor(
    private readonly workflowDecisionsService: WorkflowDecisionsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    protected readonly tabNavigationService: TabNavigationService,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super();
  }

  // Slack shows the modal as failed after 3 seconds, so the decision (and
  // re-rendering the tab with it) runs after the answer.
  protected async onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    const { id: stepId } = meta;
    const pageMetadata = meta.pageMetadata ? JSON.parse(meta.pageMetadata) : {};

    runInBackground(this.logger, `approve step ${stepId}`, async () => {
      await this.workflowDecisionsService.approveStep(stepId, user);

      this.tabNavigationService.navigate(TabId.Approvals, {
        user,
        metadata: pageMetadata,
        notice: decisionNotice(
          await this.requestWorkflowStepsService.findOne({
            id: stepId,
            slackTeamId: user.slack_team_id,
          }),
          user,
          WorkflowStepStatus.Approved,
          '✅ Approved. The request moves on to the next approvers, if there are any.',
        ),
      });
    });
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    metadata: IConfirmationModalViewMetadata,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error approving pending request step: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getView(
        {
          ...REQUEST_CONFIRMATION_VIEW_CONFIG.approve,
          errorMessage,
        },
        metadata,
      ),
    );
  }
}
