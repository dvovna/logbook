import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import SlackEventsService from 'src/slack/services/slack-events.service';
import { SlackUserGuard } from 'src/common/guards/slack-user.guard';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';

@Controller('api/slack/events')
@UseGuards(SlackSignatureGuard, SlackUserGuard)
export default class SlackEventsController {
  public constructor(private readonly slackEventsService: SlackEventsService) {}

  @Post('/')
  public handleSlackEvent(@Req() req: Request) {
    if (req.body.type === 'url_verification') {
      return { challenge: req.body.challenge };
    }

    const event = req.body.event;

    return this.slackEventsService.handleSlackEvent(event, req.user, req.body);
  }
}
