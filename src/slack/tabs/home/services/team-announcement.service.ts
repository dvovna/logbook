import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import ProjectsService from 'src/projects/services/projects.service';

// What people need to start: where the app is and the two things they do in
// it. Time tracking only where the workspace has projects.
export const teamAnnouncementText = (tracksTime: boolean) =>
  [
    `Hi everyone! We now use *Logbook* in Slack for time off${tracksTime ? ' and time tracking' : ''}.`,
    '• Find *Logbook* under *Apps* in the Slack sidebar and open its *Home* tab: it shows your balance and your requests.',
    '• To request time off, click *🌴 Request time off* there, or type `/vacations request` in any channel.',
    ...(tracksTime
      ? ['• To log your hours, click *➕ Log Time* there, or type `/log`.']
      : []),
    "• Requests go to your team's approvers, and Logbook messages you when they're decided.",
  ].join('\n');

// The setup checklist's last step: the person gets a message for the team
// in their DM, ready to copy into a channel, and the step is done. Posting
// for them would need a channel and its scopes; they know where people read.
@Injectable()
export class TeamAnnouncementService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly projectsService: ProjectsService,
  ) {}

  public async send(user: IUserViewModel): Promise<void> {
    const projects = await this.projectsService.count({
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      {
        text: [
          'Copy this into a channel everyone reads, e.g. #general:',
          '',
          teamAnnouncementText(projects > 0),
        ].join('\n'),
      },
      user.slack_team_id,
    );
    await this.slackTeamsService.markTeamTold(user.slack_team_id);
  }
}
