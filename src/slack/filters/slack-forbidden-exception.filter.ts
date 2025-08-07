import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

@Catch(ForbiddenException)
export class SlackForbiddenExceptionFilter implements ExceptionFilter {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public async catch(exception: ForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { slack_id, team_id, requiredRoles } = exception.getResponse() as {
      slack_id?: string;
      team_id?: string;
      requiredRoles?: string[];
    };

    if (slack_id && team_id && requiredRoles) {
      await this.slackCommunicationService.postMessage(
        slack_id,
        {
          text: `⛔ Only users with role *${requiredRoles.join(', ')}* can use this command.`,
        },
        team_id,
      );
    }

    response.status(200).send();
  }
}
