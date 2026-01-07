import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import UserRole from '@common/enums/user-role.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { TabId, TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView, { IConfirmationModalViewMetadata } from '@modules/slack/common/views/components/confirmation-modal.view';
import { REQUEST_CONFIRMATION_VIEW_CONFIG } from '@modules/request-workflows/configs/request-confirmation-view-config';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApproveRequestStepMessage,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class ApproveRequestStepFormSubmitHandler
  extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  constructor(
    private readonly requestWorkflowService: RequestWorkflowService,
    protected readonly tabNavigationService: TabNavigationService,
    private readonly confirmationModalView : ConfirmationModalView,
  ) {
    super();
  }

  protected async onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    const { id: stepId } = meta;

    await this.requestWorkflowService.approveStep(stepId, user);
  }

  protected successResponse(
    _result,
    user: IUserViewModel,
    metadata: IConfirmationModalViewMetadata,
  ): ViewResponseAction {
    const pageMetadata = metadata.pageMetadata
      ? JSON.parse(metadata.pageMetadata)
      : {};

    this.tabNavigationService.navigate(TabId.Vacations, {
      user,
      metadata: pageMetadata,
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        `✅ Request step has been approved.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    metadata: IConfirmationModalViewMetadata,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error approving pending request step: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getView({
        ...REQUEST_CONFIRMATION_VIEW_CONFIG.approve,
        errorMessage,
      }, metadata),
    );
  }
}
