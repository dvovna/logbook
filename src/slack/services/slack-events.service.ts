import { isPersonWithEmail } from '@modules/slack-communication/services/slack-users.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import UserRole from '@common/enums/user-role.enum';
import SlackUserAccessService from '@modules/slack/services/slack-user-access.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import FileUploadService from '@modules/slack/services/file-upload.service';
import SlackEventType from '@modules/slack/enums/slack-event-type.enum';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { UsersService } from '@modules/users/services/users.service';
import { SlackAppUninstallService } from '@modules/slack/services/slack-app-uninstall.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { getRequestWorkspaceSlackId } from '@common/utils/slack-request.utils';
import { NEW_PERSON_PROMPT_JOB } from 'src/team-file/constants/jobs';
import { INewPersonPromptJob } from 'src/team-file/types/new-person-prompt-job.interface';

interface IFileSharedEvent {
  type: SlackEventType.FileShared;
  user_id: string;
  file_id: string;
  channel_id: string;
  team_id: string;
}

interface IHomeTabOpenedEvent {
  type: SlackEventType.HomeTabOpened;
  user: string;
  channel: string;
  tab: 'home' | unknown;
}

export interface ITeamJoinEvent {
  type: SlackEventType.TeamJoin;
  user: {
    id: string;
    team_id: string;
    name: string;
    real_name: string;
    profile: {
      email?: string;
      display_name?: string;
      image_512?: string;
    };
    is_admin: boolean;
    is_owner: boolean;
    is_bot: boolean;
    deleted: boolean;
  };
}

export interface IUserChangeEvent {
  type: SlackEventType.UserChange;
  user: {
    id: string;
    team_id: string;
    name: string;
    real_name: string;
    profile: {
      email?: string;
      display_name?: string;
      image_512?: string;
    };
    is_admin: boolean;
    is_owner: boolean;
    is_bot: boolean;
    deleted: boolean;
  };
}

interface IAppUninstalledEvent {
  type: SlackEventType.AppUninstalled;
}

export interface IAppUninstalledEventBodyData {
  type: SlackEventType.AppUninstalled;
  team_id: string;
  enterprise_id: string | null;
  user_id: string;
}

export interface IUnknownSlackEvent {
  type: Exclude<
    string,
    | SlackEventType.FileShared
    | SlackEventType.HomeTabOpened
    | SlackEventType.TeamJoin
    | SlackEventType.AppUninstalled
    | SlackEventType.UserChange
  >;
  [key: string]: unknown;
}

export type SlackEvent =
  | IFileSharedEvent
  | IHomeTabOpenedEvent
  | ITeamJoinEvent
  | IAppUninstalledEvent
  | IUserChangeEvent;

export enum SlackEventJob {
  FileShared = 'slack-event-file-shared',
  TeamJoin = 'slack-event-team-join',
  UserChange = 'slack-event-user-change',
  AppUninstalled = 'slack-event-app-uninstalled',
}

interface IEventJob<Event> {
  event: Event;
  userId?: string;
  slackTeamId?: string;
  // The workspace the event came from (team_join on Enterprise Grid).
  workspaceSlackId?: string;
}

@Injectable()
export default class SlackEventsService implements OnModuleInit {
  private readonly logger = new Logger(SlackEventsService.name);

  public constructor(
    private readonly slackUserAccessService: SlackUserAccessService,
    private readonly fileUploadService: FileUploadService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly usersService: UsersService,
    private readonly slackAppUninstallService: SlackAppUninstallService,
    private readonly slackTeamService: SlackTeamsService,
    private readonly jobs: JobsService,
  ) {}

  // Slack sends an event once and gets its answer at once, so the work runs
  // as a job: a failure or a restart in the middle is retried. A job carries
  // the event and the user's ID; the user is read again when it runs.
  public onModuleInit() {
    this.jobs.define<IEventJob<IFileSharedEvent>>(
      SlackEventJob.FileShared,
      async ({ event, userId, slackTeamId }) =>
        this.handleFileShared(event, await this.findUser(userId, slackTeamId)),
    );
    this.jobs.define<IEventJob<ITeamJoinEvent>>(
      SlackEventJob.TeamJoin,
      async ({ event, userId, slackTeamId, workspaceSlackId }) =>
        this.handleUserJoin(
          event,
          await this.findUser(userId, slackTeamId),
          workspaceSlackId,
        ),
    );
    this.jobs.define<IEventJob<IUserChangeEvent>>(
      SlackEventJob.UserChange,
      async ({ event, userId, slackTeamId }) =>
        this.handleUserChange(event, await this.findUser(userId, slackTeamId)),
    );
    this.jobs.define<{ teamSlackId: string }>(
      SlackEventJob.AppUninstalled,
      ({ teamSlackId }) => this.handleAppUninstalled(teamSlackId),
    );
  }

  public async handleSlackEvent(
    event: SlackEvent,
    user: IUserViewModel | undefined,
    body: Record<string, unknown>,
  ) {
    switch (event.type) {
      case SlackEventType.FileShared:
        void this.jobs.run<IEventJob<IFileSharedEvent>>(
          SlackEventJob.FileShared,
          { event, ...this.actor(user) },
        );

        break;
      case SlackEventType.HomeTabOpened:
        this.handleHomeTapOpened(event, user);

        break;
      case SlackEventType.TeamJoin:
        void this.jobs.run<IEventJob<ITeamJoinEvent>>(SlackEventJob.TeamJoin, {
          event,
          ...this.actor(user),
          workspaceSlackId: getRequestWorkspaceSlackId(body),
        });

        break;
      case SlackEventType.UserChange:
        void this.jobs.run<IEventJob<IUserChangeEvent>>(
          SlackEventJob.UserChange,
          { event, ...this.actor(user) },
        );

        break;
      case SlackEventType.AppUninstalled: {
        const { team_id: teamSlackId } =
          body as unknown as IAppUninstalledEventBodyData;

        void this.jobs.run(SlackEventJob.AppUninstalled, { teamSlackId });

        break;
      }
      default:
        throw new Error(
          `Unsupported event type: ${(event as IUnknownSlackEvent).type}`,
        );
    }

    return { ok: true };
  }

  private actor(user: IUserViewModel | undefined) {
    return user ? { userId: user.id, slackTeamId: user.slack_team_id } : {};
  }

  private async findUser(userId?: string, slackTeamId?: string) {
    if (!userId || !slackTeamId) {
      return undefined;
    }

    return (
      (await this.usersService.findOne({
        id: userId,
        slackTeamId,
        includeInactive: true,
      })) ?? undefined
    );
  }

  private async handleAppUninstalled(teamSlackId: string) {
    await this.slackAppUninstallService.uninstall(teamSlackId);
  }

  private async handleUserChange(
    event: IUserChangeEvent,
    user?: IUserViewModel,
  ) {
    if (!user) {
      return;
    }

    // `user` is the changed user as the guard found them in the workspace the
    // event comes from.
    this.logger.log('Handling user change', {
      slackId: event.user.id,
      deleted: event.user.deleted,
      slackTeamId: user.slack_team_id,
    });

    await this.usersService.upsert({
      slackId: event.user.id,
      role: user.role,
      email: event.user.profile.email!,
      name: event.user.real_name || user.name,
      // A deleted Slack account deactivates the user, but nothing in Slack
      // reactivates one: someone deactivated in Logbook would otherwise come
      // back (with their old role) after changing their status or avatar.
      isActive: event.user.deleted ? false : user.is_active,
      slackTeamId: user.slack_team_id,
    });
  }

  // `user` is the joining user if the workspace already knows them: Slack can
  // announce someone again, e.g. a guest made a full member. Their role,
  // status and team stay as Logbook has them; only the profile is updated.
  private async handleUserJoin(
    event: ITeamJoinEvent,
    user: IUserViewModel | undefined,
    workspaceSlackId: string | undefined,
  ) {
    if (user) {
      this.logger.log('Handling a join of a known user', {
        slackId: event.user.id,
        slackTeamId: user.slack_team_id,
      });

      await this.usersService.upsert({
        slackId: user.slack_id,
        role: user.role,
        email: event.user.profile.email || user.email,
        name: event.user.real_name || user.name,
        isActive: user.is_active,
        slackTeamId: user.slack_team_id,
      });

      return;
    }

    // An app's bot joins when the app is installed, and has no email: as
    // the member import does, leave out bots and accounts without an email
    // instead of failing (and retrying for hours) on the missing email.
    if (!isPersonWithEmail(event.user)) {
      this.logger.log(
        'Ignoring a join of a bot or an account without an email',
        {
          slackId: event.user.id,
          isBot: event.user.is_bot,
        },
      );

      return;
    }

    // The workspace the event comes from: on Enterprise Grid the user's own
    // team_id can name another workspace of the organization.
    const slackTeam = await this.slackTeamService.findOneWithValidation({
      slackId: workspaceSlackId,
    });

    this.logger.log('Handling new user join', {
      slackId: event.user.id,
      slackTeamId: slackTeam.slack_id,
    });

    const created = (await this.usersService.upsert({
      slackId: event.user.id,
      role:
        event.user.is_admin || event.user.is_owner
          ? UserRole.Admin
          : UserRole.Member,
      contractStartDate: new Date(),
      email: event.user.profile.email!,
      name: event.user.real_name,
      isActive: !event.user.deleted,
      slackTeamId: slackTeam.id,
    })) as IUserViewModel;

    // Before the first member import finished, the import brings everyone
    // in and asks about nobody. Not awaited: this job holds a slot that the
    // prompt's job may be waiting for (JobsService).
    if (slackTeam.members_imported_at) {
      void this.jobs.run<INewPersonPromptJob>(NEW_PERSON_PROMPT_JOB, {
        slackTeamId: slackTeam.id,
        userId: created.id,
      });
    }
  }

  public async handleFileShared(
    event: IFileSharedEvent,
    user: IUserViewModel | undefined,
  ) {
    // Files shared by people the app doesn't know, or has deactivated, are
    // not its business.
    if (!user?.is_active) {
      return;
    }

    // A refusal is final: running the job again would only repeat it.
    if (
      !(await this.slackUserAccessService.checkUserRoleAccess(
        user,
        ADMIN_AND_HR_ROLES,
      ))
    ) {
      return;
    }

    const { file_id: fileId, channel_id: channelId } = event;

    await this.fileUploadService.handleFileUpload(fileId, channelId, user);
  }

  public handleHomeTapOpened(
    event: IHomeTabOpenedEvent,
    user: IUserViewModel | undefined,
  ) {
    if (!user) {
      this.logger.warn(`Skipping home tab for unknown user ${event.user}`);

      return;
    }

    this.tabNavigationService.navigate(TabId.Home, { user });
  }
}
