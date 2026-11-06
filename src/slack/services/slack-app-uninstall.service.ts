import { Injectable, Logger } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';

@Injectable()
export class SlackAppUninstallService {
  private readonly logger = new Logger(SlackAppUninstallService.name);

  public constructor(private readonly slackTeamService: SlackTeamsService) {}

  public async uninstall(teamSlackId: string): Promise<void> {
    const slackTeam = await this.slackTeamService.findOne({
      slackId: teamSlackId,
    });

    if (!slackTeam) {
      this.logger.warn(`Slack team with ID ${teamSlackId} not found.`);
      return;
    }

    await this.slackTeamService.delete({ id: slackTeam.id });

    this.logger.log(
      `Deleted Slack team with ID ${teamSlackId} and name ${slackTeam.name}.`,
    );
  }
}
