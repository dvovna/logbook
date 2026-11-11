import { Injectable, Logger } from '@nestjs/common';
import { runInBackground } from '@common/utils/run-in-background';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import { IOfferMessage } from '@modules/slack/tabs/vacation-requests/types/time-off-offer.types';
import { TimeOffOfferView } from '@modules/slack/tabs/vacation-requests/views/time-off-offer.view';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';

@Injectable()
export class TimeOffLogClickService {
  private readonly logger = new Logger(TimeOffLogClickService.name);

  public constructor(
    private readonly timeOffLoggingService: TimeOffLoggingService,
    private readonly communicationService: SlackCommunicationService,
    private readonly view: TimeOffOfferView,
  ) {}

  // What can be refused answers the clicker here; the logging and the
  // message update run after the answer. Someone else's click is dropped with
  // a warning, as an approver step's refused click is.
  public async handleClick(
    user: IUserViewModel,
    requestId: string,
    message: IOfferMessage,
  ) {
    try {
      await this.timeOffLoggingService.assertCanLog(user, requestId);
    } catch (error) {
      if (await this.refuse(error, user, message.channel)) {
        return;
      }

      throw error;
    }

    runInBackground(this.logger, 'log time off as time', async () => {
      try {
        const { offer, linked } = await this.timeOffLoggingService.log(
          user,
          requestId,
        );

        if (message.channel && message.ts) {
          await this.communicationService.updateMessage(
            message.channel,
            message.ts,
            this.view.getResultMessage(message.blocks ?? [], offer, linked),
            user.slack_team_id,
          );
        }
      } catch (error) {
        // What changed since the DM (the project archived, the request
        // canceled) is told to the clicker. Anything else is told generally
        // and rethrown, so it is logged and reported.
        if (await this.refuse(error, user, message.channel)) {
          return;
        }

        await this.tell(
          user,
          message.channel,
          "Couldn't log your time off, please try again.",
        ).catch(() => undefined);

        throw error;
      }
    });
  }

  private async refuse(
    error: unknown,
    user: IUserViewModel,
    channel: string | undefined,
  ): Promise<boolean> {
    switch (classifyActionError(error)) {
      case 'refusal':
        await this.tell(user, channel, (error as Error).message);

        return true;
      case 'forbidden':
        this.logger.warn(`Time off not logged: ${(error as Error).message}`);

        return true;
      case 'unexpected':
        return false;
    }
  }

  private async tell(
    user: IUserViewModel,
    channel: string | undefined,
    text: string,
  ) {
    await this.communicationService.postEphemeral(
      channel ?? user.slack_id,
      { text },
      user.slack_team_id,
      user.slack_id,
    );
  }
}
