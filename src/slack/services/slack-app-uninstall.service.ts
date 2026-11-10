import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import EnvironmentVariable from '@common/enums/environment-variable.enum';

// app_uninstalled: the token goes at once. The data stays for
// UNINSTALLED_DATA_RETENTION_DAYS, so that installing again restores the
// workspace (WorkspaceRetentionService deletes it afterwards); with 0 it is
// deleted now.
@Injectable()
export class SlackAppUninstallService {
  private readonly logger = new Logger(SlackAppUninstallService.name);

  public constructor(
    private readonly slackTeamService: SlackTeamsService,
    private readonly accessTokenService: AccessTokenService,
    private readonly config: ConfigService,
  ) {}

  public async uninstall(teamSlackId: string): Promise<void> {
    const slackTeam = await this.slackTeamService.findOne({
      slackId: teamSlackId,
    });

    if (!slackTeam) {
      this.logger.warn(`Slack team with ID ${teamSlackId} not found.`);
      return;
    }

    const retentionDays = this.config.getOrThrow<number>(
      EnvironmentVariable.UninstalledDataRetentionDays,
    );

    if (retentionDays === 0) {
      await this.slackTeamService.deleteWorkspace(slackTeam.id);
      this.logger.log(`Deleted workspace ${teamSlackId} and its data.`);
    } else {
      await this.slackTeamService.markUninstalled(slackTeam.id);
      this.logger.log(
        `Workspace ${teamSlackId} uninstalled; its data is kept for ${retentionDays} days.`,
      );
    }

    await this.accessTokenService.forget(slackTeam.id);
  }
}
