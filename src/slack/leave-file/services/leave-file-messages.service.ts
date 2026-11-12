import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getDateOnly } from '@common/utils/date.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ILeaveFileMessage } from '@modules/slack/leave-file/types/leave-file-message.interface';
import { LeaveFileMessageView } from '@modules/slack/leave-file/views/leave-file-message.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';
import {
  ILeaveFileApplyResult,
  ILeaveFilePreview,
} from 'src/leave-file/types/leave-file-apply-result.interface';
import { ILeaveFileUndoResult } from 'src/leave-file/types/leave-file-undo-result.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';

const NOT_UNDONE =
  "The file couldn't be undone, so nothing changed. Try again.";
const NOT_APPLIED =
  "The file couldn't be applied, so nothing changed. Try again.";
const CHANGED_NOT_SHOWN =
  "Logbook changed since this preview, but the new preview couldn't be shown. Click Apply again to see it.";
// Where the clicker can check what Apply did when its message can't show it.
const APPLIED_NOT_SHOWN: Record<LeaveFileKind, string> = {
  [LeaveFileKind.Balances]:
    "Applied, but the message couldn't be updated. Open People to check.",
  [LeaveFileKind.History]:
    "Applied, but the message couldn't be updated. Open Time off to check.",
};

// The app's day, for the leave a preview counts as still to come.
const today = () => getDateOnly(new Date());

@Injectable()
export class LeaveFileMessagesService {
  private readonly logger = new Logger(LeaveFileMessagesService.name);

  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly uploadsService: LeaveFileUploadsService,
    private readonly view: LeaveFileMessageView,
  ) {}

  // A message and not an ephemeral, so that its buttons stay. Its place is
  // stored with the upload, to update it later.
  public async postPreview(
    user: IUserViewModel,
    upload: ILeaveFileUpload,
    preview: ILeaveFilePreview,
  ) {
    const slackTeamId = user.slack_team_id;
    const { channel, ts } = await this.slackCommunicationService.postMessage(
      user.slack_id,
      this.view.preview(preview, upload, today()),
      slackTeamId,
    );

    await this.uploadsService.setMessage(upload.id, slackTeamId, channel!, ts!);
  }

  // The ID in the button is the client's word: a stale or foreign one is
  // answered, and changes nothing.
  public async cancel(uploadId: string, user: IUserViewModel) {
    let upload: ILeaveFileUpload;

    try {
      upload = await this.uploadsService.cancel(uploadId, user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      return this.tellClosed(user);
    }

    await this.replaceMessage(upload, this.view.canceled());
  }

  // Runs after the click was answered. The upload's own message is updated,
  // not the one the click names: that comes from the client.
  public async apply(
    uploadId: string,
    shownDigest: string,
    user: IUserViewModel,
  ) {
    let result: ILeaveFileApplyResult;

    try {
      result = await this.uploadsService.apply(uploadId, shownDigest, user);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.tellClosed(user);
      }

      // The transaction rolled back.
      await this.tellQuietly(user, NOT_APPLIED);
      throw error;
    }

    // From here on what Apply did is committed, whatever Slack answers.
    const message = this.resultMessage(result);

    try {
      if (message && !(await this.replaceMessage(result.upload, message))) {
        throw new Error(`Upload ${result.upload.id} has no message`);
      }
    } catch (error) {
      // What Apply did, with its Undo, since the message can't hold it.
      await this.tellQuietly(
        user,
        result.kind === 'applied'
          ? APPLIED_NOT_SHOWN[result.preview.kind]
          : result.kind === 'changed'
            ? CHANGED_NOT_SHOWN
            : (message?.text ?? NOT_APPLIED),
        result.kind === 'applied' ? message?.blocks : undefined,
      );
      throw error;
    }
  }

  // Runs after the click was answered, like apply.
  public async undo(uploadId: string, user: IUserViewModel) {
    let result: ILeaveFileUndoResult;

    try {
      result = await this.uploadsService.undo(uploadId, user);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.slackCommunicationService.postEphemeral(
          user.slack_id,
          { text: 'This Undo is no longer available. Nothing changed.' },
          user.slack_team_id,
        );
      }

      await this.tellQuietly(user, NOT_UNDONE);
      throw error;
    }

    if (result.kind === 'closed') {
      return this.slackCommunicationService.postEphemeral(
        user.slack_id,
        { text: `This file can't be undone: ${result.reason}.` },
        user.slack_team_id,
      );
    }

    // From here on Undo is committed, whatever Slack answers.
    const message = this.view.undone(result.restored, result.kept);

    try {
      if (!(await this.replaceMessage(result.upload, message))) {
        throw new Error(`Upload ${result.upload.id} has no message`);
      }
    } catch (error) {
      await this.tellQuietly(user, message.text, message.blocks);
      throw error;
    }
  }

  private tellClosed(user: IUserViewModel) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text: 'This preview is no longer open. Nothing changed.' },
      user.slack_team_id,
    );
  }

  private resultMessage(
    result: ILeaveFileApplyResult,
  ): ILeaveFileMessage | null {
    switch (result.kind) {
      case 'applied':
        return this.view.applied(result.preview, result.upload.id);
      case 'changed':
        return this.view.changedPreview(result.preview, result.upload, today());
      case 'nothing':
        return this.view.nothingToChange(result.preview);
      case 'closed':
        return this.view.closed(result.status);
    }
  }

  // False when the upload has no message to replace.
  private async replaceMessage(
    upload: ILeaveFileUpload,
    { text, blocks }: ILeaveFileMessage,
  ) {
    if (!upload.message_channel || !upload.message_ts) {
      return false;
    }

    await this.slackCommunicationService.updateMessage(
      upload.message_channel,
      upload.message_ts,
      { text, blocks },
      upload.slack_team_id,
    );

    return true;
  }

  // Its own failure is only logged, so that the error which led here is the
  // one reported.
  private async tellQuietly(
    user: IUserViewModel,
    text: string,
    blocks?: ILeaveFileMessage['blocks'],
  ) {
    try {
      await this.slackCommunicationService.postEphemeral(
        user.slack_id,
        { text, ...(blocks ? { blocks } : {}) },
        user.slack_team_id,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to tell ${user.slack_id} about a leave file: ${(error as Error).message}`,
      );
    }
  }
}
