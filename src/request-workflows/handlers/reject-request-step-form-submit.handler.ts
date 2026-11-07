import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import UserRole from '@common/enums/user-role.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { REQUEST_CONFIRMATION_VIEW_CONFIG } from '@modules/request-workflows/configs/request-confirmation-view-config';
import { runInBackground } from '@common/utils/run-in-background';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.RejectRequestStepMessage,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class RejectRequestStepFormSubmitHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  constructor(
    private readonly requestWorkflowService: RequestWorkflowService,
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

    runInBackground(this.logger, `reject step ${stepId}`, async () => {
      await this.requestWorkflowService.rejectStep(stepId, user);

      this.tabNavigationService.navigate(TabId.Vacations, {
        user,
        metadata: pageMetadata,
      });
    });
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        `❌ Vacation request rejected.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    metadata: IConfirmationModalViewMetadata,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error rejecting pending request: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getView(
        {
          ...REQUEST_CONFIRMATION_VIEW_CONFIG.reject,
          errorMessage,
        },
        metadata,
      ),
    );
  }
}
