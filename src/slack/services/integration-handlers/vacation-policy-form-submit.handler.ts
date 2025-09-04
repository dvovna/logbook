import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import PolicyModalViewValuesParser, {
  IPolicyFormViewData,
} from 'src/slack/services/slack-views/parsers/policy-modal-view-values.parser';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from 'src/slack/services/vacation-policies-tab.service';
import {
  IPolicyModalViewMetadata,
  VacationPolicyModalViewService,
} from 'src/slack/services/slack-views/modal-views/vacation-policy-modal-view.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.PolicyFormSubmit,
  type: 'view_submission',
})
export class VacationPolicyFormSubmitHandler {
  public constructor(
    private readonly policyModalViewValuesParser: PolicyModalViewValuesParser,
    private readonly policyModalViewService: VacationPolicyModalViewService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly vacationPoliciesTabService: VacationPoliciesTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IPolicyModalViewMetadata>(payload);

    const { view } = payload;
    const { policyIdToEdit } = metadata;

    const { data, errors } = this.policyModalViewValuesParser.parse(
      view.state.values,
    );

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const policy = await this.createOrUpdatePolicy(
        data,
        policyIdToEdit,
        user,
      );

      this.vacationPoliciesTabService.publish({ user });

      return SlackViewResponseFactory.update(
        this.policyModalViewService.getSuccessView(
          `✅ Policy '${policy.name}' was ${policyIdToEdit ? 'updated' : 'created'} successfully!`,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof MaxItemsCountReachedError
          ? error.message
          : 'An error occurred while creating or updating the policy. Please try again later.';

      return SlackViewResponseFactory.update(
        await this.vacationPoliciesTabService.getModalView<
          | VacationPoliciesTabModalName.CreatePolicy
          | VacationPoliciesTabModalName.UpdatePolicy
        >(
          policyIdToEdit
            ? VacationPoliciesTabModalName.UpdatePolicy
            : VacationPoliciesTabModalName.CreatePolicy,
          {
            user,
            errorMessage,
            ...(policyIdToEdit ? { policyId: policyIdToEdit } : {}),
          },
        ),
      );
    }
  }

  private createOrUpdatePolicy(
    data: IPolicyFormViewData,
    policyIdToEdit: string | null,
    user: IUserViewModel,
  ) {
    if (policyIdToEdit) {
      return this.vacationPoliciesService.update(
        {
          id: policyIdToEdit,
          slackTeamId: user.slack_team_id,
        },
        {
          name: data.name,
          vacationDays: data.vacation_days,
          workingDays: data.working_days,
          bonusDays: data.bonus_days,
          carryoverDays: data.carryover_days,
        },
        user,
      );
    }

    return this.vacationPoliciesService.create(
      {
        name: data.name,
        vacationDays: data.vacation_days,
        workingDays: data.working_days,
        bonusDays: data.bonus_days,
        carryoverDays: data.carryover_days,
        slackTeamId: user.slack_team_id,
      },
      user,
    );
  }
}
