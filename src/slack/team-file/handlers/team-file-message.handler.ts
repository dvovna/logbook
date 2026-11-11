import { Injectable, NotFoundException } from '@nestjs/common';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { withButtonAction } from '@modules/slack/common/utils/view.utils';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TeamFileMessageActionId } from '@modules/slack/team-file/enums/team-file-message-action-id.enum';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TeamFileMessage,
  type: 'block_actions',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class TeamFileMessageHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    private readonly uploadsService: TeamFileUploadsService,
    private readonly messagesService: TeamFileMessagesService,
    private readonly teamsTabService: TeamsTabService,
  ) {
    super();

    this.actionMap = {
      [TeamFileMessageActionId.Cancel]: withButtonAction(this.handleCancel),
      [TeamFileMessageActionId.Rules]: withButtonAction(this.handleRules),
    };
  }

  // The ID in the button is the client's word: a stale or foreign one is
  // answered, and changes nothing.
  private handleCancel = async (uploadId: string, user: IUserViewModel) => {
    try {
      await this.messagesService.showCanceled(
        await this.uploadsService.cancel(uploadId, user),
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      await this.messagesService.tellClosed(user);
    }
  };

  // The company rules form, as on Teams; saving it shows Teams.
  private handleRules = async (
    _uploadId: string,
    user: IUserViewModel,
    triggerId: string,
  ) => {
    await this.teamsTabService.openModal(
      triggerId,
      TeamsTabModalName.CompanyRules,
      { user, pageMetadata: '' },
    );
  };
}
