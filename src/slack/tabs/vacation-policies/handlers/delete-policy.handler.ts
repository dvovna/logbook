import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from '@modules/slack/tabs/vacation-policies/services/vacation-policies-tab.service';
import { jsonParse } from '@common/utils/json-parse';
import { IHolidaysTabMetadata } from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteVacationPolicy,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class DeletePolicyHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IVacationPolicyViewModel
> {
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
      notice: `✅ Policy ${policy.name} deleted.`,
    });

    return SlackViewResponseFactory.success();
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
