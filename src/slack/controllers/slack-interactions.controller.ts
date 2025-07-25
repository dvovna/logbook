import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import SlackInteractionsService, {
  ISlackInteractionPayload,
} from 'src/slack/services/slack-interactions.service';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';

interface ISlackIntegrationBody {
  payload: string;
}

@Controller('api/slack/interactions')
@UseGuards(SlackSignatureGuard)
export default class SlackInteractionsController {
  public constructor(
    private readonly slackInteractionsService: SlackInteractionsService,
  ) {}

  @Post('/')
  public async handleSlackInteraction(
    @Body() body: ISlackIntegrationBody,
    @Res() res: Response,
  ) {
    res.status(200).send();

    const payload = JSON.parse(body.payload) as ISlackInteractionPayload;

    await this.slackInteractionsService.handleSlackInteraction(payload);
  }
}
