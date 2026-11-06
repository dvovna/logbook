import { Injectable } from '@nestjs/common';
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
import { IProjectsTabMetaData, ProjectsTabView } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ProjectsListQuery } from 'src/projects/queries/projects-list.query';
import ClientsService from '@modules/clients/services/clients.service';
import { ProjectAssignmentsModalView } from '@modules/slack/tabs/projects/views/project-assignments-modal.view';
import TeamsService from '@modules/teams/services/teams.service';
import { ProjectAssignmentsService } from 'src/projects/services/project-assignments.service';
import { UsersService } from '@modules/users/services/users.service';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { IOption } from '@modules/slack/common/types/option.interface';

interface IProjectModalViewParams extends IOpenModalBaseParams<string> {
  projectId: string;
}

export enum ProjectsTabModalName {
  CreateProject = 'CreateProject',
  UpdateProject = 'UpdateProject',
  ChangeProjectStatus = 'ChangeProjectStatus',
  ManageProjectAssignments = 'ManageProjectAssignments',
}

interface IGetProjectsTabViewParams extends IPublishBaseParams {
  metadata?: IProjectsTabMetaData;
}

export interface IProjectTabFilters {
  project?: IOption;
  status?: ProjectStatus;
  billable?: YesNoValue;
}

export const PROJECTS_TAB_PAGE_SIZE = 5;

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
};

@Injectable()
export class ProjectsTabService extends BaseTabService<ProjectsTabModalViewResolversMapType> {
  public constructor(
    private readonly projectsService: ProjectsService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly clientsService: ClientsService,
    private readonly projectAssignmentsService: ProjectAssignmentsService,
    private readonly projectsListQuery: ProjectsListQuery,
    private readonly projectModalView: ProjectModalView,
    private readonly projectAssignmentsModalView: ProjectAssignmentsModalView,
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
    });
  }

  public async getTabView({ user, metadata = {} }: IGetProjectsTabViewParams) {
    const projectsListData = await this.projectsListQuery.execute({
      slackTeamId: user.slack_team_id,
      page: metadata.page,
      pageSize: PROJECTS_TAB_PAGE_SIZE,
      status: metadata?.filters?.status,
      billable: metadata?.filters?.billable !== undefined
        ? metadata?.filters?.billable === YesNoValue.Yes
        : undefined,
      projectId: metadata?.filters?.project?.id,
      includeArchived: metadata?.includeArchived,
    });

    return await this.projectsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        projectsListData,
      },
      metadata,
    );
  }

  private async getCreateProjectModalView({
    errorMessage,
    pageMetadata,
    user,
  }: IOpenModalBaseParams<string>) {
    const clients = await this.clientsService.findMany({
      slackTeamId: user.slack_team_id,
      includeArchived: false,
    });

    return this.projectModalView.getView(
      { errorMessage, clients },
      { pageMetadata },
    );
  }

  private async getUpdateProjectModalView({
    projectId,
    user,
    pageMetadata,
    errorMessage,
  }: IProjectModalViewParams) {
    const [project, clients] = await Promise.all([
      this.projectsService.findOneWithValidation({
        id: projectId,
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
      }),
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
}
