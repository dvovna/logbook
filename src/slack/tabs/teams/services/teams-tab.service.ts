import { Injectable } from '@nestjs/common';
import TeamsService from '@modules/teams/services/teams.service';
import {
  MAX_TEAM_MEMBERS,
  TeamModalView,
} from '@modules/slack/tabs/teams/views/team-modal.view';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { UsersService } from '@modules/users/services/users.service';
import {
  ITeamsTabMetaData,
  TeamsTabView,
} from '@modules/slack/tabs/teams/views/teams-tab.view';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ITeamViewModel from '@modules/teams/types/team.interface';

interface ITeamModalViewParams extends IOpenModalBaseParams<string> {
  teamId: string;
}

export enum TeamsTabModalName {
  CreateTeam = 'CreateTeam',
  UpdateTeam = 'UpdateTeam',
  DeleteTeam = 'DeleteTeam',
}

interface IGetTeamsTabViewParams extends IPublishBaseParams {
  metadata?: ITeamsTabMetaData;
}

const TEAMS_TAB_PAGE_SIZE = 10;

type TeamsTabModalViewResolversMapType = {
  [TeamsTabModalName.CreateTeam]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
  [TeamsTabModalName.UpdateTeam]: (
    params: ITeamModalViewParams,
  ) => Promise<View>;
  [TeamsTabModalName.DeleteTeam]: (
    params: ITeamModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class TeamsTabService extends BaseTabService<TeamsTabModalViewResolversMapType> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly teamModalView: TeamModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
    private readonly teamsTabView: TeamsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Teams, {
      [TeamsTabModalName.CreateTeam]: (params) =>
        this.getCreateTeamModalView(params),
      [TeamsTabModalName.UpdateTeam]: (params) =>
        this.getUpdateTeamModalView(params),
      [TeamsTabModalName.DeleteTeam]: (params) =>
        this.getDeleteTeamModalView(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetTeamsTabViewParams) {
    const teamsData = await this.teamsService.search({
      filters: { slackTeamId: user.slack_team_id },
      orderBy: ['name:asc'],
      page: metadata.page,
      pageSize: TEAMS_TAB_PAGE_SIZE,
    });
    // The active members of the listed teams, by name.
    const members = await this.usersService.findMany({
      slackTeamId: user.slack_team_id,
      teamIds: teamsData.items.map(({ id }) => id),
    });
    const membersByTeam: Record<string, string[]> = {};
    for (const member of members.sort((a, b) => a.name.localeCompare(b.name))) {
      (membersByTeam[member.team_id!] ??= []).push(member.name);
    }

    return await this.teamsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        teamsData,
        membersByTeam,
      },
      metadata,
    );
  }

  private async getCreateTeamModalView({
    user,
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    const { policies, managers, hrUsers } = await this.getTeamFormData(user);

    return this.teamModalView.getView(
      {
        policies,
        errorMessage,
        managers,
        hrUsers,
      },
      {
        pageMetadata,
        setsMembers: true,
      },
    );
  }

  private async getUpdateTeamModalView({
    teamId,
    user,
    pageMetadata,
    errorMessage,
  }: ITeamModalViewParams) {
    const team = await this.teamsService.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    const [{ policies, managers, hrUsers }, members] = await Promise.all([
      this.getTeamFormData(user, team),
      this.usersService.findMany({
        slackTeamId: user.slack_team_id,
        teamId: team.id,
      }),
    ]);

    return this.teamModalView.getView(
      {
        policies,
        initialData: {
          id: team.id,
          name: team.name,
          description: team.description,
          vacation_policy_id: team.vacation_policy_id,
          managerApprovers: team.manager_approvers || undefined,
          hrApprovers: team.hr_approvers || undefined,
          approvalNotificationRecipients:
            team.approval_notification_recipients || undefined,
          managerApproversRule: team.manager_approvers_rule,
          hrApproversRule: team.hr_approvers_rule,
          members: members
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ id, name }) => ({ id, name })),
        },
        errorMessage,
        managers,
        hrUsers,
      },
      {
        id: team.id,
        pageMetadata,
        setsMembers: members.length <= MAX_TEAM_MEMBERS,
      },
    );
  }

  private async getDeleteTeamModalView({
    teamId,
    user,
    errorMessage,
    pageMetadata,
  }: ITeamModalViewParams) {
    const team = await this.teamsService.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteTeam,
        title: 'Delete Team',
        message: `The team *${team.name}* will be permanently deleted. This action cannot be undone.`,
        errorMessage,
      },
      {
        id: team.id,
        pageMetadata,
      },
    );
  }

  private async getTeamFormData(user: IUserViewModel, team?: ITeamViewModel) {
    const [policies, users] = await Promise.all([
      this.vacationPoliciesService.findMany({
        slackTeamId: user.slack_team_id,
      }),
      this.usersService.findMany({
        slackTeamId: user.slack_team_id,
        roles: [UserRole.HR, UserRole.Manager, UserRole.Admin],
      }),
    ]);

    const managers = users
      .filter(
        (user) =>
          [UserRole.Manager, UserRole.Admin].includes(user.role) ||
          team?.manager_approvers?.includes(user.slack_id),
      )
      .map((user) => ({ name: user.name, id: user.slack_id }));

    const hrUsers = users
      .filter(
        (user) =>
          [UserRole.HR, UserRole.Admin].includes(user.role) ||
          team?.hr_approvers?.includes(user.slack_id),
      )
      .map((user) => ({ name: user.name, id: user.slack_id }));

    return {
      policies,
      managers,
      hrUsers,
    };
  }
}
