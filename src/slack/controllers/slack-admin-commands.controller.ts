import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { SlackSignatureGuard } from 'src/common/guards/slack-signature.guard';
import { SlackUserGuard } from 'src/common/guards/slack-user.guard';
import { UpdateSettingsDto } from 'src/slack/dto/update-settings.dto';
import TeamSettingsCommandService from 'src/slack/services/team-settings-command.service';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import UserRole from 'src/common/enums/user-role.enum';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import SlackPromptsService from 'src/slack-communication/services/slack-prompts.service';

@Controller('api/slack/admin')
@UseGuards(SlackSignatureGuard, SlackUserGuard)
export default class AdminCommandsController {
  public constructor(
    private readonly teamSettingsCommandService: TeamSettingsCommandService,
    private readonly slackUserAccessService: SlackUserAccessService,
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

    await this.slackUserAccessService.checkUserRoleAccess(
      req.user!,
      UserRole.Admin,
    );

    const args = body.text?.trim().split(/\s+/) ?? [];
    const subcommand = args[0];
    const commandArgs = args.slice(1);

    const message = await this.teamSettingsCommandService.handleCommand(
      subcommand,
      commandArgs,
      req.user!,
    );

    await this.slackCommunicationService.postMessage(
      req.user!.slack_id,
      { text: message },
      req.user!.team_id,
    );
  }

  @Post('/user-vacations-upload')
  public async uploadVacations(@Req() req: Request, @Res() res: Response) {
    res.status(200).send();

    await this.slackUserAccessService.checkUserRoleAccess(
      req.user!,
      UserRole.Admin,
    );

    await this.slackCommunicationService.postMessage(
      req.user!.slack_id,
      this.slackPromptService.getUploadFilePromptMessage(),
      req.user!.team_id,
    );

    return;
  }
}
