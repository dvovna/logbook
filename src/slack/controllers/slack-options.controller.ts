import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SlackUserOptionsService } from '../services/slack-user-options.service';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';
import { SlackUserGuard } from 'src/common/guards/slack-user.guard';
import { Request } from 'express';
import { VacationRequestsTabViewActionId } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { BlockSuggestion } from '@slack/bolt/dist/types/options';

@Controller('api/slack/options')
@UseGuards(SlackSignatureGuard, SlackUserGuard)
export class SlackOptionsController {
  public constructor(
    private readonly userOptionsService: SlackUserOptionsService,
  ) {}

  @Post('/')
  public getOptions(@Req() req: Request, @Body() payload: BlockSuggestion) {
    const actionId = payload.action_id as unknown;

    switch (actionId) {
      case VacationRequestsTabViewActionId.UserField:
      case VacationRequestsTabViewActionId.FilterRequestsByUser: {
        return this.userOptionsService.searchUsers(payload.value, req.user!);
      }
      default: {
        return { options: [] };
      }
    }
  }
}
