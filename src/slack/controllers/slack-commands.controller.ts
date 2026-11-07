import { SlackUserAccessFilter } from '@modules/slack/filters/slack-user-access.filter';
import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { runInBackground } from '@common/utils/run-in-background';
import { ISlackCommandBodyData } from '@common/types/slack.types';
import VacationCommandService, {
  VacationCommand,
} from '@modules/slack/services/vacation-command.service';
import { SlackSignatureGuard } from '@common/guards/slack-signature.guard';
import { SlackUserGuard } from '@common/guards/slack-user.guard';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackActiveUserGuard } from '@common/guards/slack-active-user.guard';

@Controller('api/slack')
@UseFilters(SlackUserAccessFilter)
@UseGuards(SlackSignatureGuard, SlackUserGuard, SlackActiveUserGuard)
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

    runInBackground(this.logger, `handle /vacations ${command}`, async () => {
      try {
        await this.vacationCommandService.handleCommand(
          command,
          req.user!,
          req.body.trigger_id,
        );
      } catch (e) {
        this.logger.error('Error handling vacation command:', e);
        await this.slackCommunicationService.postEphemeral(
          req.user!.slack_id,
          { text: 'An error occurred while processing your command.' },
          req.user!.slack_team_id,
        );
      }
    });
  }
}
