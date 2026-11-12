import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { ITeamFileMessage } from '@modules/slack/team-file/types/team-file-message.interface';
import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { ITeamFileApplyResult } from 'src/team-file/types/team-file-apply-result.interface';
import { ITeamFileUndoResult } from 'src/team-file/types/team-file-undo-result.interface';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

const NOT_UNDONE =
  "The file couldn't be undone, so nothing changed. Try again.";
const NOT_APPLIED =
  "The file couldn't be applied, so nothing changed. Try again.";
// What the clicker is told when the message can't show what Apply did;
// otherwise the message's own text.
const NOT_SHOWN: Partial<Record<ITeamFileApplyResult['kind'], string>> = {
  applied: "Applied, but the message couldn't be updated. Open Teams to check.",
  changed:
    "Logbook changed since this preview, but the new preview couldn't be shown. Click Apply again to see it.",
};

// The name of every person and team of the workspace by ID.
const namesOf = ({ people, teams }: ITeamFileState) =>
  new Map([
    ...people.map((p) => [p.id, personLabel(p)] as const),
    ...teams.map((t) => [t.id, t.name] as const),
  ]);

@Injectable()
export class TeamFileMessagesService {
  private readonly logger = new Logger(TeamFileMessagesService.name);

  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly uploadsService: TeamFileUploadsService,
    private readonly companyRulesService: CompanyRulesService,
    private readonly view: TeamFileMessageView,
  ) {}

  // A message and not an ephemeral, so that its buttons stay. Its place is
  // stored with the upload, to update it later.
  public async postPreview(
    user: IUserViewModel,
    upload: ITeamFileUpload,
    plan: ITeamFilePlan,
    { people, teams }: ITeamFileState,
  ) {
    const slackTeamId = user.slack_team_id;
    const companyRules = await this.companyRulesService.get(slackTeamId);
    const blocks = this.view.preview(
      plan,
      namesOf({ people, teams }),
      companyRules,
      upload.id,
      upload.file_name,
    );

    const { channel, ts } = await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text: this.view.previewText(upload.file_name), blocks },
      slackTeamId,
    );

    await this.uploadsService.setMessage(upload.id, slackTeamId, channel!, ts!);
  }

  public async showCanceled(upload: ITeamFileUpload) {
    await this.replaceMessage(upload, this.view.canceled());
  }

  // Runs after the click was answered. The upload's own message is updated,
  // not the one the click names: that comes from the client.
  public async apply(
    uploadId: string,
    shownDigest: string,
    user: IUserViewModel,
  ) {
    let result: ITeamFileApplyResult;

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
    let message: ITeamFileMessage | null = null;

    try {
      message = await this.resultMessage(result, user);

      if (message && !(await this.replaceMessage(result.upload, message))) {
        throw new Error(`Upload ${result.upload.id} has no message`);
      }
    } catch (error) {
      // What Apply did, with its Undo, since the message can't hold it.
      await this.tellQuietly(
        user,
        NOT_SHOWN[result.kind] ?? message?.text ?? NOT_APPLIED,
        result.kind === 'applied' ? message?.blocks : undefined,
      );
      throw error;
    }
  }

  // Runs after the click was answered, like apply.
  public async undo(uploadId: string, user: IUserViewModel) {
    let result: ITeamFileUndoResult;

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
        { text: `Undo is no longer available: ${result.reason}.` },
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

  public tellClosed(user: IUserViewModel) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text: 'This preview is no longer open. Nothing changed.' },
      user.slack_team_id,
    );
  }

  private async resultMessage(
    result: ITeamFileApplyResult,
    user: IUserViewModel,
  ): Promise<ITeamFileMessage | null> {
    switch (result.kind) {
      case 'applied':
        return this.view.applied(
          result.plan,
          namesOf(result.state),
          result.upload.id,
        );
      case 'changed':
        return this.view.changedPreview(
          result.plan,
          namesOf(result.state),
          await this.companyRulesService.get(user.slack_team_id),
          result.upload.id,
        );
      case 'nothing':
        return this.view.nothingToChange(result.plan);
      case 'closed':
        return this.view.closed(result.status);
    }
  }

  // False when the upload has no message to replace.
  private async replaceMessage(
    upload: ITeamFileUpload,
    { text, blocks }: ITeamFileMessage,
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
    blocks?: ITeamFileMessage['blocks'],
  ) {
    try {
      await this.slackCommunicationService.postEphemeral(
        user.slack_id,
        { text, ...(blocks ? { blocks } : {}) },
        user.slack_team_id,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to tell ${user.slack_id} about a team file: ${(error as Error).message}`,
      );
    }
  }
}
