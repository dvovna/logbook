import { Injectable, Logger } from '@nestjs/common';
import type { ButtonAction } from '@slack/bolt';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { runInBackground } from '@common/utils/run-in-background';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { LeaveFileMessageActionId } from '@modules/slack/leave-file/enums/leave-file-message-action-id.enum';
import { LeaveFileMessagesService } from '@modules/slack/leave-file/services/leave-file-messages.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

// The parts of a button value after its action: `<upload id>` and, for
// Apply, `<digest of the plan shown>`. A missing part reads as an unknown
// upload or another plan.
const valueParts = (payload: ISlackBlockActionPayload) => {
  const [, uploadId = '', digest = ''] = (
    (payload.actions[0] as ButtonAction).value ?? ''
  ).split(':');

  return { uploadId, digest };
};

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.LeaveFileMessage,
  type: 'block_actions',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class LeaveFileMessageHandler extends BaseActionHandler {
  private readonly logger = new Logger(LeaveFileMessageHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    private readonly messagesService: LeaveFileMessagesService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();

    this.actionMap = {
      [LeaveFileMessageActionId.Apply]: this.handleApply,
      [LeaveFileMessageActionId.Undo]: this.handleUndo,
      [LeaveFileMessageActionId.Cancel]: (payload, user) =>
        this.messagesService.cancel(valueParts(payload).uploadId, user),
      [NavigationActionId.People]: (_payload, user) =>
        this.tabNavigationService.navigate(TabId.Users, { user, metadata: {} }),
      [NavigationActionId.TimeOff]: (_payload, user) =>
        this.tabNavigationService.navigate(TabId.TimeOff, {
          user,
          metadata: {},
        }),
    };
  }

  // Applying a file of thousands of rows takes longer than Slack waits for
  // the answer.
  private handleApply = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const { uploadId, digest } = valueParts(payload);

    runInBackground(this.logger, 'apply a leave file', () =>
      this.messagesService.apply(uploadId, digest, user),
    );
  };

  private handleUndo = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const { uploadId } = valueParts(payload);

    runInBackground(this.logger, 'undo a leave file', () =>
      this.messagesService.undo(uploadId, user),
    );
  };
}
