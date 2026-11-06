import { Injectable, Logger } from '@nestjs/common';
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
        this.runInBackground(event.type, () =>
          this.handleFileShared(event, user!),
        );

        break;
      case SlackEventType.HomeTabOpened:
        this.handleHomeTapOpened(event, user);

        break;
      case SlackEventType.TeamJoin:
        this.runInBackground(event.type, () => this.handleUserJoin(event));

        break;
      case SlackEventType.UserChange:
        this.runInBackground(event.type, () =>
          this.handleUserChange(event, user),
        );

        break;
      case SlackEventType.AppUninstalled: {
        const { team_id: teamSlackId } =
          body as unknown as IAppUninstalledEventBodyData;

        this.runInBackground(event.type, () =>
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

  // Slack expects a response within 3 seconds, so handlers are not awaited.
  // Their errors are logged here, otherwise an unhandled rejection would
  // terminate the process.
  private runInBackground(
    eventType: SlackEventType,
    handler: () => Promise<void>,
  ) {
    handler().catch((error: Error) => {
      this.logger.error(
        `Failed to handle ${eventType} event: ${error.message}`,
        error.stack,
      );
    });
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

    const existingUser = await this.usersService.findBySlackId(event.user.id);
    const slackTeam = await this.slackTeamService.findOneWithValidation({
      slackId: event.user.team_id,
    });

    this.logger.log('Handling user change', {
      slackId: event.user.id,
      teamId: user?.team_id,
      email: event.user.profile.email,
      name: event.user.real_name,
      isActive: !event.user.deleted,
      slackTeamId: slackTeam.slack_id,
    });

    await this.usersService.upsert({
      slackId: event.user.id,
      teamId: existingUser?.team_id || null,
      role: user.role,
      email: event.user.profile.email!,
      name: event.user.real_name || user.name,
      isActive: !event.user.deleted,
      slackTeamId: slackTeam?.id,
    });
  }

  private async handleUserJoin(event: ITeamJoinEvent) {
    const slackTeam = await this.slackTeamService.findOneWithValidation({
      slackId: event.user.team_id,
    });

    this.logger.log('Handling new user join', {
      slackId: event.user.id,
      email: event.user.profile.email,
      name: event.user.real_name,
      isActive: !event.user.deleted,
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

  public async handleFileShared(event: IFileSharedEvent, user: IUserViewModel) {
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
