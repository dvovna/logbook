import { Injectable } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import FileUploadService from 'src/slack/services/file-upload.service';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import SlackEventType from 'src/slack/enums/slack-event-type';

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

export interface IUnknownSlackEvent {
  type: Exclude<string, IFileSharedEvent['type'] | IHomeTabOpenedEvent['type']>;
  [key: string]: unknown;
}

export type SlackEvent = IFileSharedEvent | IHomeTabOpenedEvent;

@Injectable()
export default class SlackEventsService {
  public constructor(
    private readonly slackUserAccessService: SlackUserAccessService,
    private readonly fileUploadService: FileUploadService,
    private readonly homeTabService: HomeTabService,
  ) {}

  public handleSlackEvent(event: SlackEvent, user: IUserViewModel) {
    switch (event.type) {
      case SlackEventType.FileShared:
        this.handleFileShared(event, user);

        break;
      case SlackEventType.HomeTabOpened:
        this.handleHomeTapOpened(user);

        break;
      default:
        throw new Error(
          `Unsupported event type: ${(event as IUnknownSlackEvent).type}`,
        );
    }

    return { ok: true };
  }

  public async handleFileShared(event: IFileSharedEvent, user: IUserViewModel) {
    await this.slackUserAccessService.checkUserRoleAccess(user, UserRole.Admin);

    const { file_id: fileId } = event;

    await this.fileUploadService.handleFileUpload(fileId, user);
  }

  public async handleHomeTapOpened(user: IUserViewModel) {
    await this.homeTabService.publishHomeTab(user);
  }
}
