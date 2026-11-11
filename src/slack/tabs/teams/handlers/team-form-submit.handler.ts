import { UsersService } from '@modules/users/services/users.service';
import { Injectable } from '@nestjs/common';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import TeamModalViewValuesParser, {
  ITeamFormViewData,
} from '@modules/slack/tabs/teams/parsers/team-modal-view-values.parser';
import TeamsService from '@modules/teams/services/teams.service';
import {
  ITeamModalViewMetadata,
  TeamModalView,
} from '@modules/slack/tabs/teams/views/team-modal.view';
import { NO_POLICY_VALUE } from '@modules/slack/tabs/teams/constants/no-policy';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import ITeamViewModel from '@modules/teams/types/team.interface';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import UserRole from '@common/enums/user-role.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ITeamsTabMetaData } from '@modules/slack/tabs/teams/views/teams-tab.view';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TeamFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class TeamFormSubmitHandler extends BaseModalFormSubmitHandler<
  ITeamModalViewMetadata,
  ITeamFormViewData,
  ITeamViewModel
> {
  public constructor(
    private readonly teamModalView: TeamModalView,
    private readonly teamsService: TeamsService,
    private readonly teamsTabService: TeamsTabService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
    teamModalViewValuesParser: TeamModalViewValuesParser,
  ) {
    super(teamModalViewValuesParser);
  }

  protected successResponse(
    team: ITeamViewModel,
    user: IUserViewModel,
    metadata: ITeamModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as ITeamsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Teams, {
      user,
      metadata: pageMetadata,
      notice: `✅ Team ${team.name} ${metadata.id ? 'updated' : 'created'}.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async onSubmit(
    data: ITeamFormViewData,
    metadata: ITeamModalViewMetadata,
    user: IUserViewModel,
  ) {
    await this.assertPolicyInWorkspace(data, user);

    const team = metadata.id
      ? await this.update(metadata.id, data, user)
      : await this.create(data, user);

    // Only users of the workspace are touched, whatever IDs the form sends.
    if (metadata.setsMembers) {
      await this.usersService.setTeamMembers(
        team.id,
        (data.members ?? []).map(({ value }) => value),
        user,
      );
    }

    return team;
  }

  // The policy ID comes from the form, so it has to be one of the
  // workspace's policies.
  private async assertPolicyInWorkspace(
    data: ITeamFormViewData,
    user: IUserViewModel,
  ) {
    const policyId = data.policy?.value;

    if (
      data.rules.value === TeamRulesChoice.Company ||
      !policyId ||
      policyId === NO_POLICY_VALUE
    ) {
      return;
    }

    const policy = await this.vacationPoliciesService.findOne({
      id: policyId,
      slackTeamId: user.slack_team_id,
    });

    if (!policy) {
      throw new ValidationError(
        'This vacation policy is not in this workspace.',
      );
    }
  }

  // The fields of its own rules are only on the form, and only taken, while
  // the team has its own rules. A team that follows the company rules keeps
  // whatever it holds in them, which nothing reads.
  private ownRulesOf(data: ITeamFormViewData) {
    if (data.rules.value === TeamRulesChoice.Company) {
      return { followsCompanyRules: true };
    }

    return {
      followsCompanyRules: false,
      vacationPolicyId:
        data.policy?.value === NO_POLICY_VALUE ? null : data.policy?.value,
      hrApprovers: data.hr_approvers?.map((option) => option.value),
      approvalNotificationRecipients: data.approval_notification_recipients,
      hrApproversRule: data.hr_approvers_rule?.[0]?.value || ApprovalRule.Any,
    };
  }

  private create(
    data: ITeamFormViewData,
    user: IUserViewModel,
  ): Promise<ITeamViewModel> {
    return this.teamsService.create(
      {
        name: data.name,
        description: data.description,
        slackTeamId: user.slack_team_id,
        managerApprovers: data.manager_approvers?.map((option) => option.value),
        managerApproversRule:
          data.manager_approvers_rule?.[0]?.value || ApprovalRule.Any,
        ...this.ownRulesOf(data),
      },
      user,
    );
  }

  private update(
    id: string,
    data: ITeamFormViewData,
    user: IUserViewModel,
  ): Promise<ITeamViewModel> {
    return this.teamsService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        name: data.name,
        description: data.description,
        managerApprovers: data.manager_approvers?.map((option) => option.value),
        managerApproversRule:
          data.manager_approvers_rule?.[0]?.value || ApprovalRule.Any,
        ...this.ownRulesOf(data),
      },
      user,
    );
  }

  protected async errorResponse(
    errorMessage: string,
    data: ITeamFormViewData,
    metadata: ITeamModalViewMetadata,
    user: IUserViewModel,
  ) {
    const updatedModalView = await this.getModalView(
      metadata,
      errorMessage,
      user,
      data.rules.value,
    );

    return SlackViewResponseFactory.update(updatedModalView);
  }

  private async getModalView(
    metadata: ITeamModalViewMetadata,
    errorMessage: string,
    user: IUserViewModel,
    rules: TeamRulesChoice,
  ) {
    if (metadata.id) {
      return this.teamsTabService.getModalView(TeamsTabModalName.UpdateTeam, {
        teamId: metadata.id,
        errorMessage,
        user,
        pageMetadata: metadata.pageMetadata,
        rules,
      });
    }

    return this.teamsTabService.getModalView(TeamsTabModalName.CreateTeam, {
      errorMessage,
      user,
      pageMetadata: metadata.pageMetadata,
      rules,
    });
  }
}
