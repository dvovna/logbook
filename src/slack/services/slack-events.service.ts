import { Injectable, Logger } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import FileUploadService from 'src/slack/services/file-upload.service';
import SlackEventType from 'src/slack/enums/slack-event-type.enum';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { UsersService } from 'src/users/services/users.service';
import { SlackAppUninstallService } from 'src/slack/services/slack-app-uninstall.service';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';

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

  public handleSlackEvent(
    event: SlackEvent,
    user: IUserViewModel | undefined,
    body: Record<string, unknown>,
  ) {
    switch (event.type) {
      case SlackEventType.FileShared:
        this.handleFileShared(event, user!);

        break;
      case SlackEventType.HomeTabOpened:
        this.handleHomeTapOpened(user!);

        break;
      case SlackEventType.TeamJoin:
        this.handleUserJoin(event);

        break;
      case SlackEventType.UserChange:
        this.handleUserChange(event, user);

        break;
      case SlackEventType.AppUninstalled: {
        this.handleAppUninstalled(
          (body as unknown as IAppUninstalledEventBodyData).team_id,
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
      name: event.user.real_name,
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

  public handleHomeTapOpened(user: IUserViewModel) {
    this.tabNavigationService.navigate(TabId.Home, { user });
  }
}
