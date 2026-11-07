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
import UserRole from '@common/enums/user-role.enum';
import {
  ProjectsTabModalName,
  ProjectsTabService,
} from '@modules/slack/tabs/projects/services/projects-tab.service';
import { IProjectsTabMetaData } from '@modules/slack/tabs/projects/views/projects-tab.view';
import ProjectAssignmentsModalViewValuesParser, {
  IProjectAssignmentsFormViewData,
} from '@modules/slack/tabs/projects/parsers/project-assignments-modal-view-values.parser';
import {
  IProjectAssignmentsModalViewMetadata,
  ProjectAssignmentsModalView,
} from '@modules/slack/tabs/projects/views/project-assignments-modal.view';
import { ProjectAssignmentsService } from 'src/projects/services/project-assignments.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ProjectAssignmentsFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class ProjectAssignmentsFormSubmitHandler extends BaseModalFormSubmitHandler<
  IProjectAssignmentsModalViewMetadata,
  IProjectAssignmentsFormViewData
> {
  public constructor(
    private readonly projectAssignmentsModalView: ProjectAssignmentsModalView,
    private readonly projectAssignmentsService: ProjectAssignmentsService,
    private readonly projectsTabService: ProjectsTabService,
    private readonly tabNavigationService: TabNavigationService,
    projectAssignmentsModalViewValuesParser: ProjectAssignmentsModalViewValuesParser,
  ) {
    super(projectAssignmentsModalViewValuesParser);
  }

  protected successResponse(
    _: void,
    user: IUserViewModel,
    metadata: IProjectAssignmentsModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IProjectsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Projects, {
      user,
      metadata: pageMetadata,
    });

    return SlackViewResponseFactory.update(
      this.projectAssignmentsModalView.getSuccessView(
        `✅ Project assignments was updated successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: IProjectAssignmentsFormViewData,
    metadata: IProjectAssignmentsModalViewMetadata,
    user: IUserViewModel,
  ) {
    const userIds = data.project_users?.map(({ value }) => value) || [];
    const teamIds = data.project_teams?.map(({ value }) => value) || [];

    return this.projectAssignmentsService.assignEntities({
      slackTeamId: user.slack_team_id,
      projectId: metadata.id,
      teamIds,
      userIds,
    });
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IProjectAssignmentsFormViewData,
    metadata: IProjectAssignmentsModalViewMetadata,
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
    metadata: IProjectAssignmentsModalViewMetadata,
    errorMessage: string,
    user: IUserViewModel,
  ) {
    return this.projectsTabService.getModalView(
      ProjectsTabModalName.ManageProjectAssignments,
      {
        projectId: metadata.id,
        errorMessage,
        user,
        pageMetadata: metadata.pageMetadata,
      },
    );
  }
}
