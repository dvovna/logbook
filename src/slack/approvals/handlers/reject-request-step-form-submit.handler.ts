import { WorkflowDecisionsService } from '@modules/request-workflows/services/workflow-decisions.service';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { RejectStepModalView } from '@modules/slack/approvals/views/reject-step-modal.view';
import UserRole from '@common/enums/user-role.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  IRejectWithReasonModalViewMetadata,
  RejectWithReasonModalView,
} from '@modules/slack/common/views/components/reject-with-reason-modal.view';
import RejectReasonModalViewValuesParser, {
  IRejectReasonFormViewData,
} from '@modules/slack/common/parsers/reject-reason-modal-view-values.parser';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { runInBackground } from '@common/utils/run-in-background';

// The Reject form of an approval step, from the approver's message or the
// Vacations tab: rejects the request and tells the requester why.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.RejectRequestStepMessage,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class RejectRequestStepFormSubmitHandler extends BaseModalFormSubmitHandler<
  IRejectWithReasonModalViewMetadata,
  IRejectReasonFormViewData
> {
  constructor(
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly workflowDecisionsService: WorkflowDecisionsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly rejectStepModalView: RejectStepModalView,
    private readonly rejectWithReasonModalView: RejectWithReasonModalView,
    protected readonly tabNavigationService: TabNavigationService,
    formParser: RejectReasonModalViewValuesParser,
  ) {
    super(formParser);
  }

  // Slack shows the modal as failed after 3 seconds, so the decision (and
  // re-rendering the tab with it) runs after the answer. Whether the user may
  // decide is checked before, so the modal can still say so.
  protected async onSubmit(
    { reason }: IRejectReasonFormViewData,
    meta: IRejectWithReasonModalViewMetadata,
    user: IUserViewModel,
  ) {
    const { id: stepId, pageMetadata } = meta;
    const step = await this.requestWorkflowStepsService.findOneWithValidation({
      id: stepId,
      slackTeamId: user.slack_team_id,
    });

    this.requestWorkflowService.assertCanActOnStep(step, user);

    runInBackground(this.logger, `reject step ${stepId}`, async () => {
      await this.workflowDecisionsService.rejectStep(stepId, user, reason);

      // Opened from the Vacations tab, which then shows the request gone.
      if (pageMetadata !== undefined) {
        this.tabNavigationService.navigate(TabId.Vacations, {
          user,
          metadata: JSON.parse(pageMetadata || '{}'),
        });
      }
    });
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.update(
      this.rejectWithReasonModalView.getSuccessView(
        '❌ Vacation request rejected. The requester gets a message about it.',
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IRejectReasonFormViewData,
    meta: IRejectWithReasonModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error rejecting pending request: ${errorMessage}`);

    try {
      return SlackViewResponseFactory.update(
        await this.rejectStepModalView.getView(meta.id, user, {
          pageMetadata: meta.pageMetadata,
          errorMessage,
        }),
      );
    } catch {
      // The user may not see the request at all: say what went wrong only.
      return SlackViewResponseFactory.update(
        this.rejectWithReasonModalView.getSuccessView(`⚠️ ${errorMessage}`),
      );
    }
  }
}
