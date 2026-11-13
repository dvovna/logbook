import { Injectable } from '@nestjs/common';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { NO_POLICY_VALUE } from '@modules/slack/tabs/teams/constants/no-policy';
import CompanyRulesViewValuesParser, {
  ICompanyRulesFormViewData,
} from '@modules/slack/tabs/teams/parsers/company-rules-view-values.parser';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import { ICompanyRulesModalMetadata } from '@modules/slack/tabs/teams/views/company-rules-modal.view';
import { ITeamsTabMetaData } from '@modules/slack/tabs/teams/views/teams-tab.view';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { RuleInputsValidationService } from '@modules/slack/tabs/teams/services/rule-inputs-validation.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CompanyRulesSubmit,
  type: 'view_submission',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class CompanyRulesFormSubmitHandler extends BaseModalFormSubmitHandler<
  ICompanyRulesModalMetadata,
  ICompanyRulesFormViewData,
  IRuleSetViewModel
> {
  public constructor(
    private readonly companyRulesService: CompanyRulesService,
    private readonly teamsTabService: TeamsTabService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly ruleInputsValidationService: RuleInputsValidationService,
    parser: CompanyRulesViewValuesParser,
  ) {
    super(parser);
  }

  protected async onSubmit(
    data: ICompanyRulesFormViewData,
    _metadata: ICompanyRulesModalMetadata,
    user: IUserViewModel,
  ) {
    const hrApprovers = (data.hr_approvers ?? []).map(({ value }) => value);
    const vacationPolicyId =
      data.policy.value === NO_POLICY_VALUE ? null : data.policy.value;

    await Promise.all([
      this.ruleInputsValidationService.assertPolicyInWorkspace(
        vacationPolicyId,
        user,
      ),
      this.ruleInputsValidationService.assertLevel2Approvers(hrApprovers, user),
      this.ruleInputsValidationService.assertRecipients(
        data.approval_notification_recipients ?? [],
        user,
      ),
    ]);

    return this.companyRulesService.update(
      user.slack_team_id,
      {
        hrApprovers,
        hrApproversRule: data.hr_approvers_rule?.[0]?.value ?? ApprovalRule.Any,
        notificationRecipients: data.approval_notification_recipients ?? [],
        vacationPolicyId,
      },
      user,
    );
  }

  protected successResponse(
    _rules: IRuleSetViewModel,
    user: IUserViewModel,
    metadata: ICompanyRulesModalMetadata,
  ) {
    const notice = '✅ Company rules saved.';

    if (metadata.openedFrom === TabId.Home) {
      this.tabNavigationService.navigate(TabId.Home, { user, notice });
    } else {
      this.tabNavigationService.navigate(TabId.Teams, {
        user,
        metadata: metadata.pageMetadata
          ? (JSON.parse(metadata.pageMetadata) as ITeamsTabMetaData)
          : {},
        notice,
      });
    }

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ICompanyRulesFormViewData,
    metadata: ICompanyRulesModalMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.teamsTabService.getModalView(TeamsTabModalName.CompanyRules, {
        errorMessage,
        user,
        pageMetadata: metadata.pageMetadata,
        openedFrom: metadata.openedFrom,
      }),
    );
  }
}
