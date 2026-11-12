import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { TeamFileTemplateService } from 'src/team-file/services/team-file-template.service';

@Injectable()
export class TeamFileDmService {
  public constructor(
    private readonly templateService: TeamFileTemplateService,
    private readonly dmFileService: DmFileService,
  ) {}

  public async sendTemplate(user: IUserViewModel) {
    await this.dmFileService.send(user, {
      intro:
        '📄 Here are your people. Fill in *Team* and *Team lead* (`yes`), then send the file back to me here. Nothing changes until you check what it will do and press Apply.',
      title: 'Team setup',
      filename: 'team-setup.csv',
      content: await this.templateService.build(user.slack_team_id),
    });
  }
}
