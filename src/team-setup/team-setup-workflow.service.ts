import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import ISlackTeamViewModel from '@modules/slack-teams/types/slack-team.interface';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import UserRole from '@common/enums/user-role.enum';
import delay from '@common/utils/delay';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import {
  IBotTokens,
  SlackTeamsService,
} from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import SlackUsersService from '@modules/slack-communication/services/slack-users.service';
import { TeamUsersSyncService } from '@modules/team-setup/team-users-sync.service';

interface ITeamSetupWorkflowParams {
  slackTeamId: string;
  slackTeamName: string;
  tokens: IBotTokens;
  slackUserId: string;
}

export const SYNC_USERS_JOB = 'team-sync-users';
export const WELCOME_JOB = 'team-welcome';

interface IWelcomeJob {
  slackTeamId: string;
  slackUserId: string;
}

// The installing admin's first message: what to set up, in what order.
export const WELCOME_TEXT = [
  "👋 *Logbook is installed, and you're its admin.* Set it up in the app's *Home* tab, in this order:",
  '1. *Settings → Policies*: a vacation policy, with its days and holidays. Without one, time off is tracked with no limits.',
  "2. *Settings → Teams*: teams and their approvers. Approvers need the Manager or HR role: change people's roles under *People* first.",
  "3. *People*, or a team's form: put everyone in a team, so their requests reach its approvers.",
  '4. *Settings → Projects*: projects, if you track time.',
  'Until that is done, Home shows a checklist.',
].join('\n');

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
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  // Importing the workspace's members takes a while after the install, so it
  // is a job: a restart or a Slack failure in the middle is retried, and the
  // sync only adds and updates, so running it again is safe.
  public onModuleInit() {
    this.jobs.define<IWelcomeJob>(WELCOME_JOB, async (job) => {
      await this.slackCommunicationService.postMessage(
        job.slackUserId,
        { text: WELCOME_TEXT },
        job.slackTeamId,
      );
    });

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
    tokens,
  }: ITeamSetupWorkflowParams): Promise<void> {
    const installed = await this.slackTeamsService.findOne({
      slackId: slackTeamId,
    });

    if (installed) {
      return this.reinstall(installed, {
        slackTeamName,
        slackUserId,
        tokens,
      });
    }

    const { user: installer } = await this.slackUsersService.getUserWithToken(
      slackUserId,
      tokens.token,
    );

    if (!installer.profile.email) {
      throw new Error(
        'Email is not available for the authed user. Check scopes and workspace settings.',
      );
    }

    // The workspace and its first admin, in one transaction.
    const workspace = await this.slackTeamsService.createWorkspace({
      slackId: slackTeamId,
      name: slackTeamName,
      tokens,
      admin: {
        slackId: slackUserId,
        email: installer.profile.email,
        name: installer.profile.real_name || 'Admin User',
      },
    });

    void this.jobs.run<IWelcomeJob>(WELCOME_JOB, {
      slackTeamId: workspace.id,
      slackUserId,
    });
    void this.jobs.run<ISyncUsersJob>(SYNC_USERS_JOB, {
      slackTeamId: workspace.id,
      userSlackIdsToIgnore: [slackUserId],
    });
  }

  // Installing again (e.g. for new scopes) keeps the workspace's data and
  // roles: it only stores the new token. Within the grace period after an
  // uninstall it restores the workspace, and the members who joined or left
  // meanwhile are synced. Whoever reinstalls doesn't become an admin; one who
  // isn't a user yet is added as a member.
  private async reinstall(
    workspace: ISlackTeamViewModel,
    {
      slackTeamName,
      slackUserId,
      tokens,
    }: Omit<ITeamSetupWorkflowParams, 'slackTeamId'>,
  ) {
    const { id } = workspace;

    await this.slackTeamsService.updateInstall(id, {
      name: slackTeamName,
      tokens,
    });
    await this.accessTokenService.forget(id);

    if (workspace.uninstalled_at) {
      void this.jobs.run<ISyncUsersJob>(SYNC_USERS_JOB, {
        slackTeamId: id,
        userSlackIdsToIgnore: [slackUserId],
      });
    }

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
