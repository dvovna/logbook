import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import TeamsService from '@modules/teams/services/teams.service';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import ITeamViewModel from '@modules/teams/types/team.interface';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import UserRole from '@common/enums/user-role.enum';

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
