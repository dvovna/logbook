import { Injectable, Logger } from '@nestjs/common';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';

@Injectable()
export class SlackAppUninstallService {
  private readonly logger = new Logger(SlackAppUninstallService.name);

  public constructor(private readonly slackTeamService: SlackTeamsService) {}

  public async uninstall(slackTeamId: string): Promise<void> {
    const slackTeam = await this.slackTeamService.findOne({
      slackId: slackTeamId,
    });

    if (!slackTeam) {
      this.logger.warn(`Slack team with ID ${slackTeamId} not found.`);
      return;
    }

    await this.slackTeamService.delete({ slackId: slackTeam.id });

    this.logger.log(
      `Deleted Slack team with ID ${slackTeamId} and name ${slackTeam.name}.`,
    );
  }
}
