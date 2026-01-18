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
import { ProjectsListQuery } from 'src/projects/queries/projects-list-query';

interface IProjectModalViewParams extends IOpenModalBaseParams<string> {
  projectId: string;
}

export enum ProjectsTabModalName {
  CreateProject = 'CreateProject',
  UpdateProject = 'UpdateProject',
  ArchiveProject = 'ArchiveProject',
}

interface IGetProjectsTabViewParams extends IPublishBaseParams {
  metadata?: IProjectsTabMetaData;
}

const PROJECTS_TAB_PAGE_SIZE = 5;

type ProjectsTabModalViewResolversMapType = {
  [ProjectsTabModalName.CreateProject]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
  [ProjectsTabModalName.UpdateProject]: (
    params: IProjectModalViewParams,
  ) => Promise<View>;
  [ProjectsTabModalName.ArchiveProject]: (
    params: IProjectModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class ProjectsTabService extends BaseTabService<ProjectsTabModalViewResolversMapType> {
  public constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectsListQuery: ProjectsListQuery,
    private readonly projectModalView: ProjectModalView,
    private readonly projectsTabView: ProjectsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Projects, {
      [ProjectsTabModalName.CreateProject]: (params) =>
        this.getCreateProjectModalView(params),
      [ProjectsTabModalName.UpdateProject]: (params) =>
        this.getUpdateProjectModalView(params),
      [ProjectsTabModalName.ArchiveProject]: (params) =>
        this.getDeleteProjectModalView(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetProjectsTabViewParams) {
    const projectsListData = await this.projectsListQuery.execute({
      slackTeamId: user.slack_team_id,
      search: metadata.search,
      page: metadata.page,
      pageSize: PROJECTS_TAB_PAGE_SIZE,
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
  }: IOpenModalBaseParams<string>) {
    return this.projectModalView.getView(
      { errorMessage },
      { pageMetadata },
    );
  }

  private async getUpdateProjectModalView({
    projectId,
    user,
    pageMetadata,
    errorMessage,
  }: IProjectModalViewParams) {
    const project = await this.projectsService.findOneWithValidation({
      id: projectId,
      slackTeamId: user.slack_team_id,
    });

    return this.projectModalView.getView(
      {
        initialData: {
          id: project.id,
          name: project.name,
          description: project.description,
        },
        errorMessage,
      },
      { id: project.id, pageMetadata },
    );
  }

  private async getDeleteProjectModalView({
    projectId,
    user,
    errorMessage,
    pageMetadata,
  }: IProjectModalViewParams) {
    const project = await this.projectsService.findOneWithValidation({
      id: projectId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.ArchiveProject,
        title: 'Archive Project',
        message: `The project *${project.name}* will be archived.`,
        errorMessage,
      },
      {
        id: project.id,
        pageMetadata,
      },
    );
  }
}
