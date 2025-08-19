import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import SlackInteractionsService from 'src/slack/services/slack-interactions.service';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { SlackUserGuard } from 'src/common/guards/slack-user.guard';

@Controller('api/slack/interactions')
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
