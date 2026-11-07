import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import UserRole from '@common/enums/user-role.enum';
import delay from '@common/utils/delay';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import SlackUsersService from '@modules/slack-communication/services/slack-users.service';
import { TeamUsersSyncService } from '@modules/team-setup/team-users-sync.service';

interface ITeamSetupWorkflowParams {
  slackTeamId: string;
  slackTeamName: string;
  teamSlackToken: string;
  slackUserId: string;
}

export const SYNC_USERS_JOB = 'team-sync-users';

interface ISyncUsersJob {
  slackTeamId: string;
  userSlackIdsToIgnore: string[];
}

@Injectable()
export class TeamSetupWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(TeamSetupWorkflowService.name);

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly usersService: UsersService,
    private readonly slackUsersService: SlackUsersService,
    private readonly teamUsersSyncService: TeamUsersSyncService,
    private readonly accessTokenService: AccessTokenService,
    private readonly jobs: JobsService,
  ) {}

  // Importing the workspace's members takes a while after the install, so it
  // is a job: a restart or a Slack failure in the middle is retried, and the
  // sync only adds and updates, so running it again is safe.
  public onModuleInit() {
    this.jobs.define<ISyncUsersJob>(SYNC_USERS_JOB, async (job) => {
      // No hurry: the installing admin is in already.
      await delay(5000);
      await this.teamUsersSyncService.syncUsers(job);
    });
  }

  public async execute({
    slackTeamId,
    slackTeamName,
    slackUserId,
    teamSlackToken,
  }: ITeamSetupWorkflowParams): Promise<void> {
    const installed = await this.slackTeamsService.findOne({
      slackId: slackTeamId,
    });

    if (installed) {
      return this.reinstall(installed.id, {
        slackTeamName,
        slackUserId,
        teamSlackToken,
      });
    }

    const slackTeam = await this.slackTeamsService.create({
      slack_id: slackTeamId,
      name: slackTeamName,
      slack_token: teamSlackToken,
    });

    const userProfile = await this.slackUsersService.getUser(
      slackUserId,
      slackTeam.id,
    );

    if (!userProfile.user.profile.email) {
      throw new Error(
        'Email is not available for the authed user. Check scopes and workspace settings.',
      );
    }

    try {
      const adminUser = await this.usersService.create({
        slackId: slackUserId,
        teamId: null,
        slackTeamId: slackTeam.id,
        email: userProfile.user.profile.email,
        name: userProfile.user.profile.real_name || 'Admin User',
        role: UserRole.Admin,
      });

      void this.jobs.run<ISyncUsersJob>(SYNC_USERS_JOB, {
        slackTeamId: slackTeam.id,
        userSlackIdsToIgnore: [adminUser.slack_id],
      });
    } catch (error) {
      await this.slackTeamsService.delete({ id: slackTeam.id });
      throw error;
    }
  }

  // Installing again (e.g. for new scopes) keeps the workspace's data and
  // roles: it only stores the new token. Whoever reinstalls doesn't become an
  // admin; one who isn't a user yet is added as a member.
  private async reinstall(
    id: string,
    {
      slackTeamName,
      slackUserId,
      teamSlackToken,
    }: Omit<ITeamSetupWorkflowParams, 'slackTeamId'>,
  ) {
    await this.slackTeamsService.updateInstall(id, {
      name: slackTeamName,
      slackToken: teamSlackToken,
    });
    await this.accessTokenService.forget(id);

    if (await this.usersService.findBySlackId(slackUserId, id)) {
      return;
    }

    const { user } = await this.slackUsersService.getUser(slackUserId, id);

    await this.usersService.create({
      slackId: slackUserId,
      teamId: null,
      slackTeamId: id,
      email: user.profile.email!,
      name: user.profile.real_name || 'Unknown User',
      role: UserRole.Member,
    });
  }
}
