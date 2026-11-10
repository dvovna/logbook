import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import SlackEventsService from '@modules/slack/services/slack-events.service';
import { SlackSignatureGuard } from '@modules/slack/guards/slack-signature.guard';
import { SlackEventUserGuard } from '@modules/slack/guards/slack-event-user.guard';

@Controller('api/slack/events')
@UseGuards(SlackSignatureGuard, SlackEventUserGuard)
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
