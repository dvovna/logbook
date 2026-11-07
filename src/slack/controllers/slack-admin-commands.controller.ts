import {
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { runInBackground } from '@common/utils/run-in-background';
import { SlackSignatureGuard } from '@common/guards/slack-signature.guard';
import { SlackUserGuard } from '@common/guards/slack-user.guard';
import UserRole from '@common/enums/user-role.enum';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import SlackCommandPromptsService from '@modules/slack-communication/services/slack-command-prompts.service';
import { RequireRoles } from '@common/decorators/user-role.decorator';
import { UserRoleGuard } from '@common/guards/user-role.guard';
import { SlackForbiddenExceptionFilter } from '@modules/slack/filters/slack-forbidden-exception.filter';
import { SlackActiveUserGuard } from '@common/guards/slack-active-user.guard';

@Controller('api/slack/admin')
@UseFilters(SlackForbiddenExceptionFilter)
@UseGuards(
  SlackSignatureGuard,
  SlackUserGuard,
  SlackActiveUserGuard,
  UserRoleGuard,
)
@RequireRoles([UserRole.Admin])
export default class AdminCommandsController {
  private readonly logger = new Logger(AdminCommandsController.name);

  public constructor(
    private readonly slackPromptService: SlackCommandPromptsService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  @Post('/user-vacations-upload')
  public async uploadVacations(@Req() req: Request, @Res() res: Response) {
    res.status(200).send();

    runInBackground(this.logger, 'post the upload prompt', () =>
      this.slackCommunicationService.postEphemeral(
        req.user!.slack_id,
        this.slackPromptService.getUploadVacationsPromptMessage(),
        req.user!.slack_team_id,
      ),
    );
  }

  @Post('/user-team-mapping-upload')
  public async uploadUserTeamMapping(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.status(200).send();

    runInBackground(this.logger, 'post the upload prompt', () =>
      this.slackCommunicationService.postEphemeral(
        req.user!.slack_id,
        this.slackPromptService.getUserTeamMappingUploadPromptMessage(),
        req.user!.slack_team_id,
      ),
    );
  }
}
