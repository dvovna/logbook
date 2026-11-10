import { PROJECTS_TAB_PAGE_SIZE } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ForbiddenException, Injectable } from '@nestjs/common';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectModalView } from '@modules/slack/tabs/projects/views/project-modal.view';
import {
  IProjectsTabMetaData,
  ProjectsTabView,
} from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ProjectsListQuery } from 'src/projects/queries/projects-list.query';
import ClientsService from '@modules/clients/services/clients.service';
import { ProjectAssignmentsModalView } from '@modules/slack/tabs/projects/views/project-assignments-modal.view';
import TeamsService from '@modules/teams/services/teams.service';
import { ProjectAssignmentsService } from 'src/projects/services/project-assignments.service';
import { UsersService } from '@modules/users/services/users.service';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { IOption } from '@common/types/option.interface';
import UserRole from '@common/enums/user-role.enum';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import {
  assertCanSeeRates,
  canSeeRates,
} from 'src/projects/constants/rate-roles';
import { PersonRateModalView } from '@modules/slack/tabs/projects/views/person-rate-modal.view';
import { CurrencyModalView } from '@modules/slack/tabs/projects/views/currency-modal.view';

interface IProjectModalViewParams extends IOpenModalBaseParams<string> {
  projectId: string;
}

export enum ProjectsTabModalName {
  CreateProject = 'CreateProject',
  UpdateProject = 'UpdateProject',
  ChangeProjectStatus = 'ChangeProjectStatus',
  ManageProjectAssignments = 'ManageProjectAssignments',
  ManagePersonRates = 'ManagePersonRates',
  ChangeCurrency = 'ChangeCurrency',
}

interface IGetProjectsTabViewParams extends IPublishBaseParams {
  metadata?: IProjectsTabMetaData;
}

type ProjectsTabModalViewResolversMapType = {
  [ProjectsTabModalName.CreateProject]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
  [ProjectsTabModalName.UpdateProject]: (
    params: IProjectModalViewParams,
  ) => Promise<View>;
  [ProjectsTabModalName.ChangeProjectStatus]: (
    params: IProjectModalViewParams,
  ) => Promise<View>;
  [ProjectsTabModalName.ManageProjectAssignments]: (
    params: IProjectModalViewParams,
  ) => Promise<View>;
  [ProjectsTabModalName.ManagePersonRates]: (
    params: IProjectModalViewParams,
  ) => Promise<View>;
  [ProjectsTabModalName.ChangeCurrency]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
};

@Injectable()
export class ProjectsTabService extends BaseTabService<ProjectsTabModalViewResolversMapType> {
  public constructor(
    private readonly projectsService: ProjectsService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly clientsService: ClientsService,
    private readonly projectAssignmentsService: ProjectAssignmentsService,
    private readonly projectRatesService: ProjectRatesService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly projectsListQuery: ProjectsListQuery,
    private readonly projectModalView: ProjectModalView,
    private readonly projectAssignmentsModalView: ProjectAssignmentsModalView,
    private readonly personRateModalView: PersonRateModalView,
    private readonly currencyModalView: CurrencyModalView,
    private readonly projectsTabView: ProjectsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Projects, {
      [ProjectsTabModalName.CreateProject]: (params) =>
        this.getCreateProjectModalView(params),
      [ProjectsTabModalName.UpdateProject]: (params) =>
        this.getUpdateProjectModalView(params),
      [ProjectsTabModalName.ChangeProjectStatus]: (params) =>
        this.getChangeProjectStatusModalView(params),
      [ProjectsTabModalName.ManageProjectAssignments]: (params) =>
        this.getManageProjectAssignmentsModalView(params),
      [ProjectsTabModalName.ManagePersonRates]: (params) =>
        this.getManagePersonRatesModalView(params),
      [ProjectsTabModalName.ChangeCurrency]: (params) =>
        this.getChangeCurrencyModalView(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetProjectsTabViewParams) {
    const projectsListData = await this.projectsListQuery.execute({
      slackTeamId: user.slack_team_id,
      page: metadata.page,
      pageSize: PROJECTS_TAB_PAGE_SIZE,
      status: metadata?.filters?.status,
      billable:
        metadata?.filters?.billable !== undefined
          ? metadata?.filters?.billable === YesNoValue.Yes
          : undefined,
      projectId: metadata?.filters?.project?.id,
      includeArchived: metadata?.includeArchived,
    });

    const projectIds = projectsListData.items.map(({ id }) => id);
    // Rates and the currency are Admin's and Finance's.
    const [peopleByProject, rates, currency] = await Promise.all([
      this.projectAssignmentsService.findPeopleByProject(
        projectIds,
        user.slack_team_id,
      ),
      canSeeRates(user.role)
        ? this.projectRatesService.findRates(projectIds, user)
        : null,
      canSeeRates(user.role)
        ? this.slackTeamsService.getCurrency(user.slack_team_id)
        : null,
    ]);

    return await this.projectsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        projectsListData,
        peopleByProject,
        rates,
        currency,
      },
      metadata,
    );
  }

  // The project form has the project's rate: for Admin and Finance only.
  private async getCreateProjectModalView({
    errorMessage,
    pageMetadata,
    user,
  }: IOpenModalBaseParams<string>) {
    assertCanSeeRates(user);

    const [clients, currency] = await Promise.all([
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
        includeArchived: false,
      }),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    return this.projectModalView.getView(
      { errorMessage, clients, currency },
      { pageMetadata },
    );
  }

  private async getUpdateProjectModalView({
    projectId,
    user,
    pageMetadata,
    errorMessage,
  }: IProjectModalViewParams) {
    assertCanSeeRates(user);

    const [project, clients, currency] = await Promise.all([
      this.projectsService.findOneWithValidation({
        id: projectId,
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
      }),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    const selectedClient = clients.find(
      (client) => client.id === project.client_id,
    );

    if (project.client_id && !selectedClient) {
      // If the selected client is archived or deleted, include it in the list
      const archivedClient = await this.clientsService.findOne({
        id: project.client_id,
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      });

      if (archivedClient) {
        clients.unshift(archivedClient);
      }
    }

    return this.projectModalView.getView(
      {
        initialData: project,
        clients,
        currency,
        errorMessage,
      },
      { id: project.id, pageMetadata },
    );
  }

  private async getChangeProjectStatusModalView({
    projectId,
    user,
    errorMessage,
    pageMetadata,
  }: IProjectModalViewParams) {
    const project = await this.projectsService.findOneWithValidation({
      id: projectId,
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.ChangeProjectStatus,
        title: `${project.archived_at ? 'Restore' : 'Archive'} Project`,
        message: `The project *${project.name}* will be ${project.archived_at ? 'restored' : 'archived'}.`,
        errorMessage,
      },
      {
        id: project.id,
        pageMetadata,
      },
    );
  }

  private async getManageProjectAssignmentsModalView({
    projectId,
    user,
    errorMessage,
    pageMetadata,
  }: IProjectModalViewParams) {
    const [project, teams, assignments] = await Promise.all([
      this.projectsService.findOneWithValidation({
        id: projectId,
        slackTeamId: user.slack_team_id,
      }),
      this.teamsService.findMany({
        slackTeamId: user.slack_team_id,
      }),
      this.projectAssignmentsService.getAssignments({
        projectId,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    const selectedUsers = await this.usersService.findMany({
      slackTeamId: user.slack_team_id,
      ids: assignments.userIds,
    });

    return this.projectAssignmentsModalView.getView(
      {
        assignments,
        teams,
        selectedUsers,
        errorMessage,
      },
      {
        id: project.id,
        pageMetadata,
      },
    );
  }

  private async getManagePersonRatesModalView({
    projectId,
    user,
    errorMessage,
    pageMetadata,
  }: IProjectModalViewParams) {
    assertCanSeeRates(user);

    const [project, personRates, currency] = await Promise.all([
      this.projectsService.findOneWithValidation({
        id: projectId,
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
      this.projectRatesService.findPersonRates(projectId, user),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    return this.personRateModalView.getView(
      { project, personRates, currency, errorMessage },
      { id: project.id, pageMetadata },
    );
  }

  private async getChangeCurrencyModalView({
    user,
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    if (user.role !== UserRole.Admin) {
      throw new ForbiddenException('Only an admin sets the currency.');
    }

    return this.currencyModalView.getView(
      {
        currency: await this.slackTeamsService.getCurrency(user.slack_team_id),
        errorMessage,
      },
      { pageMetadata },
    );
  }
}
