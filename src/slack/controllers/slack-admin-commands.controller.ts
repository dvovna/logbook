import {
  Controller,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';
import { SlackUserGuard } from 'src/common/guards/slack-user.guard';
import UserRole from 'src/common/enums/user-role.enum';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import SlackPromptsService from 'src/slack-communication/services/slack-prompts.service';
import { RequireRoles } from 'src/common/decorators/user-role.decorator';
import { UserRoleGuard } from 'src/common/guards/user-role.guard';
import { SlackForbiddenExceptionFilter } from 'src/slack/filters/slack-forbidden-exception.filter';

@Controller('api/slack/admin')
@UseFilters(SlackForbiddenExceptionFilter)
@UseGuards(SlackSignatureGuard, SlackUserGuard, UserRoleGuard)
@RequireRoles([UserRole.Admin])
export default class AdminCommandsController {
  public constructor(
    private readonly slackPromptService: SlackPromptsService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  @Post('/user-vacations-upload')
  public async uploadVacations(@Req() req: Request, @Res() res: Response) {
    res.status(200).send();

    await this.slackCommunicationService.postEphemeral(
      req.user!.slack_id,
      this.slackPromptService.getUploadFilePromptMessage(),
      req.user!.slack_team_id,
    );

    return;
  }
}
