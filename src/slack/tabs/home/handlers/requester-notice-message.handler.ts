import { Injectable } from '@nestjs/common';
import { ALL_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { withButtonAction } from '@modules/slack/common/utils/view.utils';
import { RequesterNoticeActionId } from '@modules/slack/tabs/vacation-requests/enums/requester-notice-action-id.enum';
import {
  HomeTabModalName,
  HomeTabService,
} from '@modules/slack/tabs/home/services/home-tab.service';

// The buttons of a DM about the requester's pending request: the same
// details and cancel forms as the request's menu on Home. The request ID
// comes from the client: the details form shows only a request the user may
// see, and only its owner cancels one.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.RequesterNoticeMessage,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
export class RequesterNoticeMessageHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(private readonly homeTabService: HomeTabService) {
    super();

    this.actionMap = {
      [RequesterNoticeActionId.ViewDetails]: withButtonAction(
        (requestId, user, triggerId) =>
          this.open(
            HomeTabModalName.ViewVacationRequest,
            requestId,
            user,
            triggerId,
          ),
      ),
      [RequesterNoticeActionId.CancelRequest]: withButtonAction(
        (requestId, user, triggerId) =>
          this.open(
            HomeTabModalName.CancelVacationRequest,
            requestId,
            user,
            triggerId,
          ),
      ),
    };
  }

  private open(
    modal:
      | HomeTabModalName.ViewVacationRequest
      | HomeTabModalName.CancelVacationRequest,
    requestId: string,
    user: IUserViewModel,
    triggerId: string,
  ) {
    return this.homeTabService.openModal(triggerId, modal, { user, requestId });
  }
}
