import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { LeaveFileMessageActionId } from '@modules/slack/leave-file/enums/leave-file-message-action-id.enum';
import { LeaveFileMessagesService } from '@modules/slack/leave-file/services/leave-file-messages.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { JobsService } from '@common/jobs/jobs.service';
import { UsersService } from '@modules/users/services/users.service';
import {
  defineUploadClickJob,
  uploadClickJobOf,
} from '@modules/slack/common/utils/upload-click-job';

export const LEAVE_FILE_APPLY_JOB = 'leave-file-apply';
export const LEAVE_FILE_UNDO_JOB = 'leave-file-undo';

// The parts of a button value after its action: `<upload id>` and, for
// Apply, `<digest of the plan shown>`. A missing part reads as an unknown
// upload or another plan.
const valueParts = (payload: ISlackBlockActionPayload) => {
  const [, uploadId = '', digest = ''] = (
    (payload.actions[0] as ButtonAction).value ?? ''
  ).split(':');

  return { uploadId, digest };
};

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.LeaveFileMessage,
  type: 'block_actions',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class LeaveFileMessageHandler
  extends BaseActionHandler
  implements OnModuleInit
{
  private readonly logger = new Logger(LeaveFileMessageHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    private readonly messagesService: LeaveFileMessagesService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly jobs: JobsService,
    private readonly usersService: UsersService,
  ) {
    super();

    this.actionMap = {
      [LeaveFileMessageActionId.Apply]: this.handleApply,
      [LeaveFileMessageActionId.Undo]: this.handleUndo,
      [LeaveFileMessageActionId.Cancel]: this.handleCancel,
      [NavigationActionId.People]: (_payload, user) =>
        this.tabNavigationService.navigate(TabId.Users, { user, metadata: {} }),
      [NavigationActionId.TimeOff]: (_payload, user) =>
        this.tabNavigationService.navigate(TabId.TimeOff, {
          user,
          metadata: {},
        }),
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
      LEAVE_FILE_APPLY_JOB,
      'apply a leave file',
      ({ uploadId, digest = '' }, user) =>
        this.messagesService.apply(uploadId, digest, user),
    );
    defineUploadClickJob(
      deps,
      LEAVE_FILE_UNDO_JOB,
      'undo a leave file',
      ({ uploadId }, user) => this.messagesService.undo(uploadId, user),
    );
  }

  // Applying a file of thousands of rows takes longer than Slack waits for
  // the answer, so it is a job (defineUploadClickJob), like Undo.
  private handleApply = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const { uploadId, digest } = valueParts(payload);

    return this.jobs.enqueue(
      LEAVE_FILE_APPLY_JOB,
      uploadClickJobOf(user, uploadId, digest),
    );
  };

  private handleUndo = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    return this.jobs.enqueue(
      LEAVE_FILE_UNDO_JOB,
      uploadClickJobOf(user, valueParts(payload).uploadId),
    );
  };

  // After the answer: replacing a preview of 50 sections takes Slack a
  // couple of seconds, of the 3 it waits for the click's answer.
  private handleCancel = (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    runInBackground(this.logger, 'cancel a leave file', () =>
      this.messagesService.cancel(valueParts(payload).uploadId, user),
    );
  };
}
