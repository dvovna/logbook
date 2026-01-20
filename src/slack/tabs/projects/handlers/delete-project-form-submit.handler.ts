import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import UserRole from '@common/enums/user-role.enum';
import IProjectViewModel from 'src/projects/types/project.types';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectsTabModalName, ProjectsTabService } from '@modules/slack/tabs/projects/services/projects-tab.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ArchiveProject,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class DeleteProjectFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IProjectViewModel
> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly projectsService: ProjectsService,
    private readonly projectsTabService: ProjectsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected successResponse(project: IProjectViewModel): ViewResponseAction {
    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        `✅ Project '${project.name}' has been successfully archived.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    return SlackViewResponseFactory.update(
      await this.projectsTabService.getModalView(ProjectsTabModalName.ArchiveProject, {
        projectId: meta.id,
        user,
        errorMessage,
        pageMetadata: meta.pageMetadata!,
      }),
    );
  }

  protected async onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IProjectViewModel> {
    const project = await this.projectsService.archive(meta.id, user);

    this.tabNavigationService.navigate(TabId.Projects, { user });

    return project;
  }
}
