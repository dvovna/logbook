import { Injectable, NotFoundException } from '@nestjs/common';
import { KnownBlock } from '@slack/types';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { ITeamFileApplyResult } from 'src/team-file/types/team-file-apply-result.interface';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

// The name of every person and team of the workspace by ID.
const namesOf = ({ people, teams }: ITeamFileState) =>
  new Map([
    ...people.map((p) => [p.id, personLabel(p)] as const),
    ...teams.map((t) => [t.id, t.name] as const),
  ]);

@Injectable()
export class TeamFileMessagesService {
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

  public showCanceled(upload: ITeamFileUpload) {
    return this.replaceMessage(upload, this.view.canceled());
  }

  // Runs after the click was answered. The upload's own message is updated,
  // not the one the click names: that comes from the client.
  public async apply(uploadId: string, user: IUserViewModel) {
    let result: ITeamFileApplyResult;

    try {
      result = await this.uploadsService.apply(uploadId, user);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.tellClosed(user);
      }

      // The transaction rolled back.
      await this.slackCommunicationService.postEphemeral(
        user.slack_id,
        {
          text: "The file couldn't be applied, so nothing changed. Try again.",
        },
        user.slack_team_id,
      );
      throw error;
    }

    const blocks = await this.resultBlocks(result, user);

    if (blocks) {
      await this.replaceMessage(result.upload, blocks);
    }
  }

  public tellClosed(user: IUserViewModel) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text: 'This preview is no longer open. Nothing changed.' },
      user.slack_team_id,
    );
  }

  private async resultBlocks(
    result: ITeamFileApplyResult,
    user: IUserViewModel,
  ): Promise<KnownBlock[] | null> {
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
      case 'closed':
        return this.view.closed(result.status);
    }
  }

  private async replaceMessage(upload: ITeamFileUpload, blocks: KnownBlock[]) {
    if (!upload.message_channel || !upload.message_ts) {
      return;
    }

    await this.slackCommunicationService.updateMessage(
      upload.message_channel,
      upload.message_ts,
      { blocks },
      upload.slack_team_id,
    );
  }
}
