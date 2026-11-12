import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { ButtonAction } from '@slack/bolt';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { runInBackground } from '@common/utils/run-in-background';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { withButtonAction } from '@modules/slack/common/utils/view.utils';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TeamFileMessageActionId } from '@modules/slack/team-file/enums/team-file-message-action-id.enum';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { JobsService } from '@common/jobs/jobs.service';
import { UsersService } from '@modules/users/services/users.service';
import {
  defineUploadClickJob,
  uploadClickJobOf,
} from '@modules/slack/common/utils/upload-click-job';

export const TEAM_FILE_APPLY_JOB = 'team-file-apply';
export const TEAM_FILE_UNDO_JOB = 'team-file-undo';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TeamFileMessage,
  type: 'block_actions',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class TeamFileMessageHandler
  extends BaseActionHandler
  implements OnModuleInit
{
  private readonly logger = new Logger(TeamFileMessageHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    private readonly uploadsService: TeamFileUploadsService,
    private readonly messagesService: TeamFileMessagesService,
    private readonly teamsTabService: TeamsTabService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly jobs: JobsService,
    private readonly usersService: UsersService,
  ) {
    super();

    this.actionMap = {
      [TeamFileMessageActionId.Apply]: this.handleApply,
      [TeamFileMessageActionId.Undo]: this.handleUndo,
      [TeamFileMessageActionId.Cancel]: withButtonAction(
        (uploadId: string, user: IUserViewModel) =>
          // After the answer: replacing a long preview takes Slack a couple
          // of seconds, of the 3 it waits for the click's answer.
          runInBackground(this.logger, 'cancel a team file', () =>
            this.handleCancel(uploadId, user),
          ),
      ),
      [TeamFileMessageActionId.Rules]: withButtonAction(this.handleRules),
      [NavigationActionId.Teams]: this.handleOpenTeams,
    };
  }

  public onModuleInit() {
    const deps = {
      jobs: this.jobs,
      usersService: this.usersService,
      logger: this.logger,
    };

    defineUploadClickJob(
      deps,
      TEAM_FILE_APPLY_JOB,
      'apply a team file',
      ({ uploadId, digest = '' }, user) =>
        this.messagesService.apply(uploadId, digest, user),
    );
    defineUploadClickJob(
      deps,
      TEAM_FILE_UNDO_JOB,
      'undo a team file',
      ({ uploadId }, user) => this.messagesService.undo(uploadId, user),
    );
  }

  // The value is `apply:<upload id>:<digest of the plan shown>`; a missing
  // part reads as an unknown upload or another plan. Applying takes many
  // statements and Slack calls, longer than Slack waits for the answer, so
  // it is a job (defineUploadClickJob), like Undo.
  private handleApply = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const [, uploadId = '', digest = ''] = (
      (payload.actions[0] as ButtonAction).value ?? ''
    ).split(':');

    return this.jobs.enqueue(
      TEAM_FILE_APPLY_JOB,
      uploadClickJobOf(user, uploadId, digest),
    );
  };

  // The ID in the button is the client's word: a stale or foreign one is
  // answered, and changes nothing.
  private handleCancel = async (uploadId: string, user: IUserViewModel) => {
    try {
      await this.messagesService.showCanceled(
        await this.uploadsService.cancel(uploadId, user),
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      await this.messagesService.tellClosed(user);
    }
  };

  // The value is `undo:<upload id>`; a missing ID reads as an unknown upload.
  // Undoing takes many statements, like Apply.
  private handleUndo = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const [, uploadId = ''] = (
      (payload.actions[0] as ButtonAction).value ?? ''
    ).split(':');

    return this.jobs.enqueue(
      TEAM_FILE_UNDO_JOB,
      uploadClickJobOf(user, uploadId),
    );
  };

  // The company rules form, as on Teams; saving it shows Teams.
  private handleRules = async (
    _uploadId: string,
    user: IUserViewModel,
    triggerId: string,
  ) => {
    await this.teamsTabService.openModal(
      triggerId,
      TeamsTabModalName.CompanyRules,
      { user, pageMetadata: '' },
    );
  };

  private handleOpenTeams = (
    _payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    this.tabNavigationService.navigate(TabId.Teams, { user, metadata: {} });
  };
}
