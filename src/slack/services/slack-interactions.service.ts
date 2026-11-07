import { Injectable, Logger } from '@nestjs/common';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
  ISlackViewSubmissionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandlersRegistry } from '@modules/slack/slack-handlers.registry';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { ActionForbiddenView } from '@modules/slack/common/views/components/action-forbidden.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

@Injectable()
class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  public constructor(
    private readonly handlersRegistry: SlackHandlersRegistry,
  ) {}

  public handleSlackInteraction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const type = payload.type;
    const callbackId = this.getCallbackId(payload) as ViewCallbackId;

    if (!callbackId) {
      this.logger.warn(`No callback_id for payload type: ${type}`);
      return;
    }

    const { handler, allowedRoles } =
      this.handlersRegistry.getHandler(type, callbackId) || {};

    if (!handler) {
      this.logger.warn(
        `No handler found for type=${type}, callback_id=${callbackId}`,
      );

      return;
    }

    if (!user.is_active && callbackId !== ViewCallbackId.FallbackTabView) {
      this.logger.warn(`Inactive user ${user.id} tried to interact with Slack`);

      return SlackViewResponseFactory.update(ActionForbiddenView.getView());
    }

    if (!allowedRoles?.includes(user.role)) {
      this.logger.warn(
        `User ${user.id} with role ${user.role} not allowed for handler ${callbackId}`,
      );

      return SlackViewResponseFactory.update(ActionForbiddenView.getView());
    }

    return handler.handle(payload, user);
  }

  private getCallbackId(payload: ISlackInteractionPayload): string | undefined {
    if ((payload as ISlackViewSubmissionPayload).view?.callback_id) {
      return (payload as ISlackViewSubmissionPayload).view.callback_id;
    }

    if ((payload as ISlackBlockActionPayload).actions?.length) {
      return (payload as ISlackBlockActionPayload).actions[0].block_id;
    }
  }
}

export default SlackInteractionsService;
