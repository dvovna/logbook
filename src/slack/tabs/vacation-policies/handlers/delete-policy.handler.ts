import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from 'src/slack/tabs/vacation-policies/services/vacation-policies-tab.service';
import { jsonParse } from 'src/common/utils/json-parse';
import { IHolidaysTabMetadata } from 'src/slack/tabs/holidays/views/holidays-tab.view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { DeleteHolidayHandler } from 'src/slack/tabs/holidays/handlers/delete-holiday.handler';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteVacationPolicy,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class DeletePolicyHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IVacationPolicyViewModel
> {
  private readonly logger = new Logger(DeleteHolidayHandler.name);

  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly policiesService: VacationPoliciesService,
    private readonly policiesTabService: VacationPoliciesTabService,
  ) {
    super();
  }

  protected async onSubmit(
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return await this.policiesService.delete({
      id: metadata.id,
      slackTeamId: user.slack_team_id,
    });
  }

  protected successResponse(
    policy: IVacationPolicyViewModel,
    user: IUserViewModel,
    metadata: IConfirmationModalViewMetadata,
  ): ViewResponseAction {
    const pageMetadata = jsonParse<IHolidaysTabMetadata>(
      metadata.pageMetadata || '{}',
    );

    this.policiesTabService.publish({
      user,
      metadata: pageMetadata!,
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        `✅ Vacation Policy '${policy.name}' has been successfully deleted.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.error(
      'Error while deleting the vacation policy: ',
      errorMessage,
    );

    return SlackViewResponseFactory.update(
      await this.policiesTabService.getModalView(
        VacationPoliciesTabModalName.DeletePolicy,
        {
          policyId: metadata.id,
          user,
          errorMessage,
          pageMetadata: metadata.pageMetadata!,
        },
      ),
    );
  }
}
