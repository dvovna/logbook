import { RATE_ROLES } from 'src/projects/constants/rate-roles';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import IProjectViewModel from 'src/projects/types/project.types';
import {
  IProjectModalViewMetadata,
  NO_CLIENT_VALUE,
  ProjectModalView,
} from '@modules/slack/tabs/projects/views/project-modal.view';
import ProjectsService from 'src/projects/services/projects.service';
import {
  ProjectsTabModalName,
  ProjectsTabService,
} from '@modules/slack/tabs/projects/services/projects-tab.service';
import ProjectModalViewValuesParser, {
  IProjectFormViewData,
} from '@modules/slack/tabs/projects/parsers/project-modal-view-values.parser';
import { IProjectsTabMetaData } from '@modules/slack/tabs/projects/views/projects-tab.view';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ProjectFormSubmit,
  type: 'view_submission',
  // The form has the project's rate.
  allowedRoles: RATE_ROLES,
})
export class ProjectFormSubmitHandler extends BaseModalFormSubmitHandler<
  IProjectModalViewMetadata,
  IProjectFormViewData,
  IProjectViewModel
> {
  public constructor(
    private readonly projectModalView: ProjectModalView,
    private readonly projectsService: ProjectsService,
    private readonly projectsTabService: ProjectsTabService,
    private readonly tabNavigationService: TabNavigationService,
    projectModalViewValuesParser: ProjectModalViewValuesParser,
  ) {
    super(projectModalViewValuesParser);
  }

  protected successResponse(
    project: IProjectViewModel,
    user: IUserViewModel,
    metadata: IProjectModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IProjectsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Projects, {
      user,
      metadata: pageMetadata,
      notice: `✅ Project ${project.name} ${metadata.id ? 'updated' : 'created'}.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected onSubmit(
    data: IProjectFormViewData,
    metadata: IProjectModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  private create(
    data: IProjectFormViewData,
    user: IUserViewModel,
  ): Promise<IProjectViewModel> {
    return this.projectsService.create(
      {
        name: data.name,
        description: data.description,
        slackTeamId: user.slack_team_id,
        clientId:
          data.clientId?.value === NO_CLIENT_VALUE
            ? null
            : data.clientId?.value,
        billable: data.billable?.value === 'true',
        status: data.status.value,
        hourlyRate: data.hourlyRate,
      },
      user,
    );
  }

  private update(
    id: string,
    data: IProjectFormViewData,
    user: IUserViewModel,
  ): Promise<IProjectViewModel> {
    return this.projectsService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        name: data.name,
        clientId:
          data.clientId?.value === NO_CLIENT_VALUE
            ? null
            : data.clientId?.value,
        description: data.description,
        billable: data.billable?.value === 'true',
        status: data.status.value,
        hourlyRate: data.hourlyRate,
      },
      user,
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IProjectFormViewData,
    metadata: IProjectModalViewMetadata,
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
    metadata: IProjectModalViewMetadata,
    errorMessage: string,
    user: IUserViewModel,
  ) {
    if (metadata.id) {
      return this.projectsTabService.getModalView(
        ProjectsTabModalName.UpdateProject,
        {
          projectId: metadata.id,
          errorMessage,
          user,
          pageMetadata: metadata.pageMetadata,
        },
      );
    }

    return this.projectsTabService.getModalView(
      ProjectsTabModalName.CreateProject,
      {
        errorMessage,
        user,
        pageMetadata: metadata.pageMetadata,
      },
    );
  }
}
