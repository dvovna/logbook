import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { BlockSuggestion } from '@slack/bolt/dist/types/options';
import { SlackSignatureGuard } from '@common/guards/slack-signature.guard';
import { SlackUserGuard } from '@common/guards/slack-user.guard';
import { SlackActiveUserGuard } from '@common/guards/slack-active-user.guard';
import { SlackUserOptionsService } from '@modules/slack/services/slack-user-options.service';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import {
  VacationRequestsTabViewActionId,
} from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';

@Controller('api/slack/options')
@UseGuards(SlackSignatureGuard, SlackUserGuard, SlackActiveUserGuard)
export class SlackOptionsController {
  public constructor(
    private readonly userOptionsService: SlackUserOptionsService,
  ) {}

  @Post('/')
  public getOptions(@Req() req: Request, @Body() payload: BlockSuggestion) {
    const actionId = payload.action_id as unknown;

    switch (actionId) {
      case VacationRequestsTabViewActionId.UserField:
      case UsersTabViewActionId.FilterUsersByUser:
      case VacationRequestsTabViewActionId.FilterRequestsByUser: {
        return this.userOptionsService.searchUsers(payload.value, req.user!);
      }
      default: {
        return { options: [] };
      }
    }
  }
}
