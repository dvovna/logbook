import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { VacationPoliciesTabService } from '@modules/slack/tabs/vacation-policies/services/vacation-policies-tab.service';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import PolicyModalViewValuesParser from '@modules/slack/tabs/vacation-policies/parsers/policy-modal-view-values.parser';
import VacationPoliciesTabActionsHandler from '@modules/slack/tabs/vacation-policies/handlers/vacation-policies-tab-actions.handler';
import { VacationPolicyFormSubmitHandler } from '@modules/slack/tabs/vacation-policies/handlers/vacation-policy-form-submit.handler';
import { DeletePolicyHandler } from '@modules/slack/tabs/vacation-policies/handlers/delete-policy.handler';
import { VacationPolicyModalView } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-modal.view';
import { VacationPolicyTabView } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';

@Module({
  imports: [VacationPoliciesModule, SlackCommonModule, TeamsModule],
  providers: [
    VacationPoliciesTabService,
    PolicyModalViewValuesParser,
    VacationPoliciesTabActionsHandler,
    VacationPolicyFormSubmitHandler,
    DeletePolicyHandler,
    VacationPolicyModalView,
    VacationPolicyTabView,
  ],
  exports: [VacationPoliciesTabService],
})
export class VacationPoliciesTabModule {}
