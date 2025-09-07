import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandlersRegistry } from 'src/slack/slack-handlers.registry';

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

    const handler = this.handlersRegistry.getHandler(type, callbackId);
    if (!handler) {
      this.logger.warn(
        `No handler found for type=${type}, callback_id=${callbackId}`,
      );
      return;
    }

    return handler.handle(payload, user);
  }
}

export default SlackInteractionsService;
