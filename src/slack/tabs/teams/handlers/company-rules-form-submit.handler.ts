import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
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
import { UsersService } from '@modules/users/services/users.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CompanyRulesSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
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
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
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
      this.assertPolicyInWorkspace(vacationPolicyId, user),
      this.assertCanApprove(hrApprovers, user),
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

  // The IDs come from the form, so they have to be the workspace's.
  private async assertPolicyInWorkspace(
    policyId: string | null,
    user: IUserViewModel,
  ) {
    if (
      policyId &&
      !(await this.vacationPoliciesService.findOne({
        id: policyId,
        slackTeamId: user.slack_team_id,
      }))
    ) {
      throw new ValidationError(
        'This vacation policy is not in this workspace.',
        'policy',
      );
    }
  }

  private async assertCanApprove(slackIds: string[], user: IUserViewModel) {
    if (!slackIds.length) {
      return;
    }

    const approvers = new Set(
      (
        await this.usersService.findMany({
          slackTeamId: user.slack_team_id,
          roles: [UserRole.HR, UserRole.Admin],
        })
      ).map(({ slack_id }) => slack_id),
    );

    if (slackIds.some((slackId) => !approvers.has(slackId))) {
      throw new ValidationError(
        'Level 2 approvers need the HR or Admin role.',
        'hr_approvers',
      );
    }
  }

  protected successResponse(
    _rules: unknown,
    user: IUserViewModel,
    metadata: ICompanyRulesModalMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.Teams, {
      user,
      metadata: metadata.pageMetadata
        ? (JSON.parse(metadata.pageMetadata) as ITeamsTabMetaData)
        : {},
      notice: '✅ Company rules saved.',
    });

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
      }),
    );
  }
}
