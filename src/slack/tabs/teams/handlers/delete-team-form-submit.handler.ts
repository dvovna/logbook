import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import TeamsService from 'src/teams/services/teams.service';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import {
  TeamsTabModalName,
  TeamsTabService,
} from 'src/slack/tabs/teams/services/teams-tab.service';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import ITeamViewModel from 'src/teams/types/team.interface';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteTeam,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class DeleteTeamFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  ITeamViewModel
> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly teamsService: TeamsService,
    private readonly teamsTabService: TeamsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected successResponse(team: ITeamViewModel): ViewResponseAction {
    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        `✅ Team '${team.name}' has been successfully deleted.`,
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
      await this.teamsTabService.getModalView(TeamsTabModalName.DeleteTeam, {
        teamId: meta.id,
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
  ): Promise<ITeamViewModel> {
    const team = await this.teamsService.delete(meta.id, user);

    this.tabNavigationService.navigate(TabId.Teams, { user });

    return team;
  }
}
