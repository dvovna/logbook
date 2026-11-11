import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
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
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import {
  IChosenApprovers,
  INewTeamModalViewParams,
} from '@modules/slack/tabs/teams/types/team-modal-params.interface';
import { CompanyRulesModalView } from '@modules/slack/tabs/teams/views/company-rules-modal.view';

interface ITeamModalViewParams extends IOpenModalBaseParams<string> {
  teamId: string;
  rules?: TeamRulesChoice;
  ruleFieldsVersion?: string;
}

export enum TeamsTabModalName {
  CreateTeam = 'CreateTeam',
  UpdateTeam = 'UpdateTeam',
  DeleteTeam = 'DeleteTeam',
  CompanyRules = 'CompanyRules',
}

interface IGetTeamsTabViewParams extends IPublishBaseParams {
  metadata?: ITeamsTabMetaData;
}

const TEAMS_TAB_PAGE_SIZE = 10;

type TeamsTabModalViewResolversMapType = {
  [TeamsTabModalName.CreateTeam]: (
    params: INewTeamModalViewParams,
  ) => Promise<View>;
  [TeamsTabModalName.UpdateTeam]: (
    params: ITeamModalViewParams,
  ) => Promise<View>;
  [TeamsTabModalName.DeleteTeam]: (
    params: ITeamModalViewParams,
  ) => Promise<View>;
  [TeamsTabModalName.CompanyRules]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
};

@Injectable()
export class TeamsTabService extends BaseTabService<TeamsTabModalViewResolversMapType> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly teamRulesService: TeamRulesService,
    private readonly companyRulesModalView: CompanyRulesModalView,
    private readonly companyRulesService: CompanyRulesService,
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
      [TeamsTabModalName.CompanyRules]: (params) =>
        this.getCompanyRulesModalView(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetTeamsTabViewParams) {
    const [teamsData, { companyRules, teams: teamRules }] = await Promise.all([
      this.teamsService.search({
        filters: { slackTeamId: user.slack_team_id },
        orderBy: ['name:asc'],
        page: metadata.page,
        pageSize: TEAMS_TAB_PAGE_SIZE,
      }),
      this.teamRulesService.forWorkspace(user.slack_team_id),
    ]);
    // The active members of the listed teams, by name.
    const members = await this.usersService.findMany({
      slackTeamId: user.slack_team_id,
      teamIds: teamsData.items.map(({ id }) => id),
    });
    const membersByTeam: Record<string, string[]> = {};
    for (const member of members.sort((a, b) => a.name.localeCompare(b.name))) {
      (membersByTeam[member.team_id!] ??= []).push(member.name);
    }

    // A team created after the two reads above started.
    const rulesByTeam = Object.fromEntries(
      teamRules.map((rules) => [rules.team!.id, rules]),
    );
    for (const { id } of teamsData.items.filter(({ id }) => !rulesByTeam[id])) {
      rulesByTeam[id] = await this.teamRulesService.forTeam(
        id,
        user.slack_team_id,
      );
    }

    return await this.teamsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        teamsData,
        membersByTeam,
        companyRules,
        rulesByTeam,
      },
      metadata,
    );
  }

  private async getCreateTeamModalView({
    user,
    errorMessage,
    pageMetadata,
    rules = TeamRulesChoice.Company,
    ruleFieldsVersion,
  }: INewTeamModalViewParams) {
    const [formData, companyRules] = await Promise.all([
      this.readTeamFormData(user),
      this.teamRulesService.forTeam(null, user.slack_team_id),
    ]);
    const { policies, managers, hrUsers } = this.approverOptions(formData, {});

    return this.teamModalView.getView(
      {
        policies,
        errorMessage,
        managers,
        hrUsers,
        rules,
        ruleValues: companyRules,
        ruleFieldsVersion,
      },
      {
        pageMetadata,
        setsMembers: true,
      },
    );
  }

  // A team that follows the company rules shows them as its own when it
  // switches to rules of its own.
  private async getUpdateTeamModalView({
    teamId,
    user,
    pageMetadata,
    errorMessage,
    rules,
    ruleFieldsVersion,
  }: ITeamModalViewParams) {
    const [team, effective, formData, members] = await Promise.all([
      this.teamsService.findOneWithValidation({
        id: teamId,
        slackTeamId: user.slack_team_id,
      }),
      this.teamRulesService.forTeam(teamId, user.slack_team_id),
      this.readTeamFormData(user),
      this.usersService.findMany({
        slackTeamId: user.slack_team_id,
        teamId,
      }),
    ]);
    const { policies, managers, hrUsers } = this.approverOptions(formData, {
      managerApprovers: effective.managerApprovers,
      hrApprovers: effective.hrApprovers,
    });

    return this.teamModalView.getView(
      {
        policies,
        initialData: {
          id: team.id,
          name: team.name,
          description: team.description,
          managerApprovers: effective.managerApprovers,
          managerApproversRule: effective.managerApproversRule,
          members: members
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ id, name }) => ({ id, name })),
        },
        rules:
          rules ??
          (effective.followsCompanyRules
            ? TeamRulesChoice.Company
            : TeamRulesChoice.Own),
        ruleValues: effective,
        ruleFieldsVersion,
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

  private async getCompanyRulesModalView({
    user,
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    const [companyRules, formData] = await Promise.all([
      this.companyRulesService.get(user.slack_team_id),
      this.readTeamFormData(user),
    ]);
    const { policies, hrUsers } = this.approverOptions(formData, {
      hrApprovers: companyRules.hr_approvers,
    });

    return this.companyRulesModalView.getView(
      {
        values: {
          vacationPolicyId: companyRules.vacation_policy_id,
          hrApprovers: companyRules.hr_approvers,
          hrApproversRule: companyRules.hr_approvers_rule,
          notificationRecipients: companyRules.approval_notification_recipients,
        },
        policies,
        hrUsers,
        errorMessage,
      },
      { pageMetadata },
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
        message: `The team *${escapeMrkdwn(team.name)}* will be permanently deleted. This action cannot be undone.`,
        errorMessage,
      },
      {
        id: team.id,
        pageMetadata,
      },
    );
  }

  private async readTeamFormData(user: IUserViewModel) {
    const [policies, users] = await Promise.all([
      this.vacationPoliciesService.findMany({
        slackTeamId: user.slack_team_id,
      }),
      this.usersService.findMany({
        slackTeamId: user.slack_team_id,
        roles: [UserRole.HR, UserRole.Manager, UserRole.Admin],
      }),
    ]);

    return { policies, users };
  }

  // A person already chosen stays in the list while they hold one of the
  // roles, e.g. a manager chosen for level 2: submitting then names them in
  // the error instead of the field dropping them.
  private approverOptions(
    { policies, users }: Awaited<ReturnType<typeof this.readTeamFormData>>,
    chosen: IChosenApprovers,
  ) {
    const managers = users
      .filter(
        (user) =>
          [UserRole.Manager, UserRole.Admin].includes(user.role) ||
          chosen.managerApprovers?.includes(user.slack_id),
      )
      .map((user) => ({ name: user.name, id: user.slack_id }));

    const hrUsers = users
      .filter(
        (user) =>
          [UserRole.HR, UserRole.Admin].includes(user.role) ||
          chosen.hrApprovers?.includes(user.slack_id),
      )
      .map((user) => ({ name: user.name, id: user.slack_id }));

    return { policies, managers, hrUsers };
  }
}
