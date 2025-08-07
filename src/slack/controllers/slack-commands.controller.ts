import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ISlackCommandBodyData } from 'src/common/types/slack.types';
import VacationCommandService, {
  VacationCommand,
} from 'src/slack/services/vacation-command.service';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';
import { SlackUserGuard } from 'src/common/guards/slack-user.guard';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

@Controller('api/slack')
@UseGuards(SlackSignatureGuard, SlackUserGuard)
export default class SlackCommandsController {
  private readonly logger = new Logger(SlackCommandsController.name);

  public constructor(
    private readonly vacationCommandService: VacationCommandService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  @Post('vacations')
  public async handleVacationCommand(
    @Req() req: Request,
    @Body() body: ISlackCommandBodyData,
    @Res() res: Response,
  ) {
    res.status(200).send();

    const args = body.text?.trim().split(/\s+/) ?? [];
    const command = args[0] as VacationCommand;

    try {
      await this.vacationCommandService.handleCommand(
        command,
        req.user!,
        req.body.trigger_id,
      );
    } catch (e) {
      this.logger.error('Error handling vacation command:', e);
      await this.slackCommunicationService.postMessage(
        req.user!.slack_id,
        { text: 'An error occurred while processing your command.' },
        req.user!.team_id,
      );
    }
  }
}
