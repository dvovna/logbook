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
    private readonly vacationRequestsTabService: VacationRequestsTabService,
  ) {
    super();
  }

  protected successResponse(
    _result: void,
    user: IUserViewModel,
    metadata: IConfirmationModalViewMetadata,
  ) {
    this.vacationRequestsTabService.publish({
      user,
      metadata:
        jsonParse<IVacationRequestsTabMetadata>(metadata.pageMetadata || '{}') ??
        undefined,
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        '✅ Approved for the approvers. The request moves on.',
      ),
    );
  }

  protected async onSubmit(
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    await this.requestWorkflowService.approveCurrentLevel(metadata.id, user);
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
