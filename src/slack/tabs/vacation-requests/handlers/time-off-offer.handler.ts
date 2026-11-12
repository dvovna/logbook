import { Injectable } from '@nestjs/common';
import { ALL_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { LOG_TIME_OFF_ACTION_ID } from '@modules/slack/tabs/vacation-requests/constants/time-off-offer';
import { TimeOffLogClickService } from '@modules/slack/tabs/vacation-requests/services/time-off-log-click.service';

// The button under an approved time off: log its working days as time. Only
// the requester may click it (the service refuses anyone else).
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeOffLoggingOffer,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
export class TimeOffOfferHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(private readonly clickService: TimeOffLogClickService) {
    super();

    this.actionMap = {
      [LOG_TIME_OFF_ACTION_ID]: this.handleLog,
    };
  }

  private handleLog = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const requestId = (payload.actions[0] as { value?: string }).value;

    if (!requestId) {
      throw new Error('No request id in the button value');
    }

    return this.clickService.handleClick(user, requestId, {
      channel: payload.channel?.id,
      ts: payload.message?.ts,
      blocks: payload.message?.blocks,
    });
  };
}
