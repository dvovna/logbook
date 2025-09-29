import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import TeamModalViewValuesParser, {
  ITeamFormViewData,
} from 'src/slack/tabs/teams/parsers/team-modal-view-values.parser';
import TeamsService from 'src/teams/services/teams.service';
import {
  ITeamModalViewMetadata,
  NO_POLICY_VALUE,
  TeamModalView,
} from 'src/slack/tabs/teams/views/team-modal.view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import ITeamViewModel from 'src/teams/types/team.interface';
import {
  TeamsTabModalName,
  TeamsTabService,
} from 'src/slack/tabs/teams/services/teams-tab.service';
import UserRole from 'src/common/enums/user-role.enum';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { ITeamsTabMetaData } from 'src/slack/tabs/teams/views/teams-tab.view';

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
    });

    return SlackViewResponseFactory.update(
      this.teamModalView.getSuccessView(
        `✅ Team '${team.name}' was ${metadata.id ? 'updated' : 'created'} successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: ITeamFormViewData,
    metadata: ITeamModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  private create(
    data: ITeamFormViewData,
    user: IUserViewModel,
  ): Promise<ITeamViewModel> {
    return this.teamsService.create(
      {
        name: data.name,
        description: data.description,
        vacationPolicyId:
          data.policy?.value === NO_POLICY_VALUE ? null : data.policy?.value,
        slackTeamId: user.slack_team_id,
        managerApprovers: data.manager_approvers?.map((option) => option.value),
        hrApprovers: data.hr_approvers?.map((option) => option.value),
        approvalNotificationRecipients: data.approval_notification_recipients,
        managerApproversRule:
          data.manager_approvers_rule?.[0]?.value || ApprovalRule.Any,
        hrApproversRule: data.hr_approvers_rule?.[0]?.value || ApprovalRule.Any,
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
        vacationPolicyId:
          data.policy?.value === NO_POLICY_VALUE ? null : data.policy?.value,
        managerApprovers: data.manager_approvers?.map((option) => option.value),
        hrApprovers: data.hr_approvers?.map((option) => option.value),
        approvalNotificationRecipients: data.approval_notification_recipients,
        managerApproversRule:
          data.manager_approvers_rule?.[0]?.value || ApprovalRule.Any,
        hrApproversRule: data.hr_approvers_rule?.[0]?.value || ApprovalRule.Any,
      },
      user,
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ITeamFormViewData,
    metadata: ITeamModalViewMetadata,
    user: IUserViewModel,
  ) {
    const updatedModalView = await this.getModalView(
      metadata,
      errorMessage,
      user,
    );

    return SlackViewResponseFactory.update(updatedModalView);
  }

  private async getModalView(
    metadata: ITeamModalViewMetadata,
    errorMessage: string,
    user: IUserViewModel,
  ) {
    if (metadata.id) {
      return this.teamsTabService.getModalView(TeamsTabModalName.UpdateTeam, {
        teamId: metadata.id,
        errorMessage,
        user,
        pageMetadata: metadata.pageMetadata,
      });
    }

    return this.teamsTabService.getModalView(TeamsTabModalName.CreateTeam, {
      errorMessage,
      user,
      pageMetadata: metadata.pageMetadata,
    });
  }
}
