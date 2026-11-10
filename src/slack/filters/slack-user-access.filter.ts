import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { View } from '@slack/types/dist/views';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackUserAccessException } from '@common/errors/slack-user-access.exception';
import { runInBackground } from '@common/utils/run-in-background';

const MESSAGES = {
  unknown: "Logbook doesn't know you yet. Ask HR or an admin to add you.",
  inactive:
    'Your Logbook account is deactivated. Ask HR or an admin to turn it back on.',
};

const noticeModal = (text: string): View => ({
  type: 'modal',
  title: { type: 'plain_text', text: 'Logbook' },
  close: { type: 'plain_text', text: 'Close' },
  blocks: [{ type: 'section', text: { type: 'plain_text', text } }],
});

// Answers someone Logbook doesn't know, or a deactivated user, with a short
// message they see, in the form each route allows: an ephemeral reply to a
// slash command, a modal update for a form, no options for a search. Slack
// shows nothing a button click answers with, so that one gets a DM.
@Catch(SlackUserAccessException)
export class SlackUserAccessFilter implements ExceptionFilter {
  private readonly logger = new Logger(SlackUserAccessFilter.name);

  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public catch(exception: SlackUserAccessException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const text = MESSAGES[exception.access];

    if (request.path.endsWith('/options')) {
      response.status(200).json({ options: [] });

      return;
    }

    if (request.path.endsWith('/interactions')) {
      if (request.body?.type === 'view_submission') {
        response
          .status(200)
          .json({ response_action: 'update', view: noticeModal(text) });

        return;
      }

      response.status(200).send();
      this.sendDirectMessage(exception, text);

      return;
    }

    response.status(200).json({ response_type: 'ephemeral', text });
  }

  private sendDirectMessage(exception: SlackUserAccessException, text: string) {
    const { slackUserId, slackTeamId } = exception;

    // Without the workspace there is no bot token to write with.
    if (!slackTeamId) {
      return;
    }

    runInBackground(this.logger, `tell ${slackUserId} why`, () =>
      this.slackCommunicationService.postMessage(
        slackUserId,
        { text },
        slackTeamId,
      ),
    );
  }
}
