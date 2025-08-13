import {
  Body,
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
import { UpdateSettingsDto } from 'src/slack/dto/update-settings.dto';
import TeamSettingsCommandService from 'src/slack/services/team-settings-command.service';
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
    private readonly teamSettingsCommandService: TeamSettingsCommandService,
    private readonly slackPromptService: SlackPromptsService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  @Post('/settings')
  public async updateSettings(
    @Req() req: Request,
    @Body() body: UpdateSettingsDto,
    @Res() res: Response,
  ) {
    res.status(200).send();

    const args = body.text?.trim().split(/\s+/) ?? [];
    const subcommand = args[0];

    await this.teamSettingsCommandService.handleCommand(
      subcommand,
      req.body.trigger_id,
      req.user!,
    );
  }

  @Post('/user-vacations-upload')
  public async uploadVacations(@Req() req: Request, @Res() res: Response) {
    res.status(200).send();

    await this.slackCommunicationService.postMessage(
      req.user!.slack_id,
      this.slackPromptService.getUploadFilePromptMessage(),
      req.user!.slack_team_id,
    );

    return;
  }
}
