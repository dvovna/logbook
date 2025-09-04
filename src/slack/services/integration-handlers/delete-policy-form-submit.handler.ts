import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { IConfirmationModalViewMetadata } from 'src/slack/services/slack-views/modal-views/confirmation-modal-view.service';
import PrimaryEntityDeleteError from 'src/common/errors/primary-entity-delete.error';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import EntityHasDependenciesError from 'src/common/errors/entity-has-dependencies.error';
import { VacationPolicyModalViewService } from 'src/slack/services/slack-views/modal-views/vacation-policy-modal-view.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from 'src/slack/services/vacation-policies-tab.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeletePolicy,
  type: 'view_submission',
})
export class DeletePolicyFormSubmitHandler {
  public constructor(
    private readonly policyModalViewService: VacationPolicyModalViewService,
    private readonly policiesService: VacationPoliciesService,
    private readonly policiesTabService: VacationPoliciesTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IConfirmationModalViewMetadata>(payload);

    const { entityId: policyIdToDelete } = metadata;

    try {
      const policy = await this.policiesService.delete({
        id: policyIdToDelete,
        slackTeamId: user.slack_team_id,
      });

      this.policiesTabService.publish({ user });

      return SlackViewResponseFactory.update(
        this.policyModalViewService.getSuccessView(
          `✅ Vacation Policy '${policy.name}' has been successfully deleted.`,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof PrimaryEntityDeleteError ||
        error instanceof EntityHasDependenciesError
          ? error.message
          : 'An error occurred while deleting the vacation policy. Please try again later.';

      return SlackViewResponseFactory.update(
        await this.policiesTabService.getModalView(
          VacationPoliciesTabModalName.DeletePolicy,
          {
            policyId: policyIdToDelete,
            user,
            errorMessage,
          },
        ),
      );
    }
  }
}
