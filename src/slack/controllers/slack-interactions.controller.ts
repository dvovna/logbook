import { SlackUserAccessFilter } from '@modules/slack/filters/slack-user-access.filter';
import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import SlackInteractionsService from '@modules/slack/services/slack-interactions.service';
import { SlackSignatureGuard } from '@modules/slack/guards/slack-signature.guard';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { SlackUserGuard } from '@modules/slack/guards/slack-user.guard';

@Controller('api/slack/interactions')
@UseFilters(SlackUserAccessFilter)
@UseGuards(SlackSignatureGuard, SlackUserGuard)
export default class SlackInteractionsController {
  public constructor(
    private readonly slackInteractionsService: SlackInteractionsService,
  ) {}

  @Post('/')
  public async handleSlackInteraction(
    @Req() req: Request,
    @Body() payload: ISlackInteractionPayload,
    @Res() res: Response,
  ) {
    const response = await this.slackInteractionsService.handleSlackInteraction(
      payload,
      req.user!,
    );

    res.status(200).send(response);
  }
}
