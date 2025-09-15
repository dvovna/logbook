import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandlersRegistry } from 'src/slack/slack-handlers.registry';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { ActionForbiddenView } from 'src/slack/common/views/components/action-forbidden.view';

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
    const callbackId = payload.view?.callback_id;

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

    if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
      this.logger.warn(
        `User ${user.id} with role ${user.role} not allowed for handler ${callbackId}`,
      );

      return SlackViewResponseFactory.update(ActionForbiddenView.getView());
    }

    return handler.handle(payload, user);
  }
}

export default SlackInteractionsService;
