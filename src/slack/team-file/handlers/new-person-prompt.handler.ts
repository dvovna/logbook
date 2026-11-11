import { Injectable } from '@nestjs/common';
import type { ButtonAction, StaticSelectAction } from '@slack/bolt';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { NewPersonPromptActionId } from '@modules/slack/team-file/enums/new-person-prompt-action-id.enum';
import { NewPersonPromptsService } from '@modules/slack/team-file/services/new-person-prompts.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.NewPersonPrompt,
  type: 'block_actions',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class NewPersonPromptHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(private readonly prompts: NewPersonPromptsService) {
    super();

    this.actionMap = {
      [NewPersonPromptActionId.ChooseTeam]: this.handleChooseTeam,
      [NewPersonPromptActionId.NotYet]: this.handleNotYet,
    };
  }

  private handleChooseTeam = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) =>
    this.prompts.choose(
      (payload.actions[0] as StaticSelectAction).selected_option?.value ?? '',
      user,
    );

  // The value is `not_yet:<user id>`.
  private handleNotYet = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const [, userId = ''] = (
      (payload.actions[0] as ButtonAction).value ?? ''
    ).split(':');

    return this.prompts.notYet(userId, user);
  };
}
