import { Injectable, Logger } from '@nestjs/common';
import { runInBackground } from '@common/utils/run-in-background';
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

interface IFileSharedEvent {
  type: SlackEventType.FileShared;
  user_id: string;
  file_id: string;
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

@Injectable()
export default class SlackEventsService {
  private readonly logger = new Logger(SlackEventsService.name);

  public constructor(
    private readonly slackUserAccessService: SlackUserAccessService,
    private readonly fileUploadService: FileUploadService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly usersService: UsersService,
    private readonly slackAppUninstallService: SlackAppUninstallService,
    private readonly slackTeamService: SlackTeamsService,
  ) {}

  public async handleSlackEvent(
    event: SlackEvent,
    user: IUserViewModel | undefined,
    body: Record<string, unknown>,
  ) {
    switch (event.type) {
      case SlackEventType.FileShared:
        runInBackground(this.logger, `handle ${event.type} event`, () =>
          this.handleFileShared(event, user),
        );

        break;
      case SlackEventType.HomeTabOpened:
        this.handleHomeTapOpened(event, user);

        break;
      case SlackEventType.TeamJoin:
        runInBackground(this.logger, `handle ${event.type} event`, () =>
          this.handleUserJoin(event, user, body),
        );

        break;
      case SlackEventType.UserChange:
        runInBackground(this.logger, `handle ${event.type} event`, () =>
          this.handleUserChange(event, user),
        );

        break;
      case SlackEventType.AppUninstalled: {
        const { team_id: teamSlackId } =
          body as unknown as IAppUninstalledEventBodyData;

        runInBackground(this.logger, `handle ${event.type} event`, () =>
          this.handleAppUninstalled(teamSlackId),
        );

        break;
      }
      default:
        throw new Error(
          `Unsupported event type: ${(event as IUnknownSlackEvent).type}`,
        );
    }

    return { ok: true };
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
      teamId: user.team_id || null,
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
    body: Record<string, unknown>,
  ) {
    if (user) {
      this.logger.log('Handling a join of a known user', {
        slackId: event.user.id,
        slackTeamId: user.slack_team_id,
      });

      await this.usersService.upsert({
        slackId: user.slack_id,
        teamId: user.team_id || null,
        role: user.role,
        email: event.user.profile.email || user.email,
        name: event.user.real_name || user.name,
        isActive: user.is_active,
        slackTeamId: user.slack_team_id,
      });

      return;
    }

    // The workspace the event comes from: on Enterprise Grid the user's own
    // team_id can name another workspace of the organization.
    const slackTeam = await this.slackTeamService.findOneWithValidation({
      slackId: getRequestWorkspaceSlackId(body),
    });

    this.logger.log('Handling new user join', {
      slackId: event.user.id,
      slackTeamId: slackTeam.slack_id,
    });

    await this.usersService.upsert({
      slackId: event.user.id,
      teamId: null,
      role:
        event.user.is_admin || event.user.is_owner
          ? UserRole.Admin
          : UserRole.Member,
      contractStartDate: new Date(),
      email: event.user.profile.email!,
      name: event.user.real_name,
      isActive: !event.user.deleted,
      slackTeamId: slackTeam.id,
    });
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

    await this.slackUserAccessService.checkUserRoleAccess(user, UserRole.Admin);

    const { file_id: fileId } = event;

    await this.fileUploadService.handleFileUpload(fileId, user);
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
