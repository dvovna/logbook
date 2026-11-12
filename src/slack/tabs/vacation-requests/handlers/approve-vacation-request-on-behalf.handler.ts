import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { WorkflowDecisionsService } from '@modules/request-workflows/services/workflow-decisions.service';
import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import {
  VacationRequestsTabModalName,
  VacationRequestsTabService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { jsonParse } from '@common/utils/json-parse';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import UserRole from '@common/enums/user-role.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { WorkflowStepStatus } from '@modules/request-workflows/types/request-workflow-step.interface';
import { decisionNotice } from '@modules/slack/approvals/utils/decision-notice';
import { ValidationError } from '@common/errors/validation.error';
import { runInBackground } from '@common/utils/run-in-background';

// HR or an admin approves the level a request is waiting on, for approvers
// who are away, so the request moves on along the approval flow.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApproveVacationRequestOnBehalf,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ApproveVacationRequestOnBehalfHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly workflowDecisionsService: WorkflowDecisionsService,
    private readonly vacationRequestsTabService: VacationRequestsTabService,
  ) {
    super();
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  // Slack shows the modal as failed when the answer takes over 3 seconds,
  // and approving (updating the approvers' messages, notifying the next
  // ones) can take longer. So only the check that can fail runs before the
  // answer; the approval itself runs after it.
  protected async onSubmit(
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    const waitingSteps =
      await this.requestWorkflowService.findCurrentLevelSteps(
        metadata.id,
        user.slack_team_id,
      );

    if (waitingSteps.length === 0) {
      throw new ValidationError(
        'This request is not waiting for anyone to approve it.',
      );
    }

    // Checked before answering, so the modal can show it.
    this.requestWorkflowService.assertNotOwnRequest(waitingSteps[0], user);

    runInBackground(
      this.logger,
      `approve request ${metadata.id} for its approvers`,
      async () => {
        await this.workflowDecisionsService.approveCurrentLevel(
          metadata.id,
          user,
        );

        await this.vacationRequestsTabService.publish({
          user,
          notice: decisionNotice(
            await this.requestWorkflowStepsService.findOne({
              id: waitingSteps[0].id,
              slackTeamId: user.slack_team_id,
            }),
            user,
            WorkflowStepStatus.Approved,
            '✅ Approved for the approvers. The request moves on.',
          ),
          metadata:
            jsonParse<IVacationRequestsTabMetadata>(
              metadata.pageMetadata || '{}',
            ) ?? undefined,
        });
      },
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.vacationRequestsTabService.getModalView(
        VacationRequestsTabModalName.ApproveOnBehalf,
        {
          requestId: metadata.id,
          user,
          errorMessage,
          pageMetadata: metadata.pageMetadata!,
        },
      ),
    );
  }
}
