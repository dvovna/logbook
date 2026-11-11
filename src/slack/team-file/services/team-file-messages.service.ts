import { Injectable } from '@nestjs/common';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

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
    const names = new Map([
      ...people.map((p) => [p.id, personLabel(p)] as const),
      ...teams.map((t) => [t.id, t.name] as const),
    ]);
    const blocks = this.view.preview(
      plan,
      names,
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
    if (!upload.message_channel || !upload.message_ts) {
      return;
    }

    await this.slackCommunicationService.updateMessage(
      upload.message_channel,
      upload.message_ts,
      { blocks: this.view.canceled() },
      upload.slack_team_id,
    );
  }

  public tellClosed(user: IUserViewModel) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text: 'This preview is no longer open. Nothing changed.' },
      user.slack_team_id,
    );
  }
}
