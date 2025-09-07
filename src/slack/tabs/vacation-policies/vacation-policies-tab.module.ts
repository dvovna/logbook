import { Module } from '@nestjs/common';
import { VacationPoliciesTabService } from 'src/slack/tabs/vacation-policies/services/vacation-policies-tab.service';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import PolicyModalViewValuesParser from 'src/slack/tabs/vacation-policies/parsers/policy-modal-view-values.parser';
import VacationPoliciesTabActionsHandler from 'src/slack/tabs/vacation-policies/handlers/vacation-policies-tab-actions.handler';
import { VacationPolicyFormSubmitHandler } from 'src/slack/tabs/vacation-policies/handlers/vacation-policy-form-submit.handler';
import { DeletePolicyHandler } from 'src/slack/tabs/vacation-policies/handlers/delete-policy.handler';
import { VacationPolicyModalView } from 'src/slack/tabs/vacation-policies/views/vacation-policy-modal.view';
import { VacationPolicyTabView } from 'src/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';

@Module({
  imports: [VacationPoliciesModule, SlackCommonModule],
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
