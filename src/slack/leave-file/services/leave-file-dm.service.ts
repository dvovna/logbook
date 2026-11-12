import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { LeaveFileTemplateService } from 'src/leave-file/services/leave-file-template.service';

const BALANCES_INTRO = `📥 *Bring in leave from your spreadsheet.* Two files, in any order: send each back to me here. Nothing changes until you check what it will do and press Apply.
• *leave-balances.csv*: each person's contract start and what they have left on the *Balance on* date, before any leave from that date on. Fill *Days left* or *Working days left*, whichever you count in, and *Bonus days left* if you have them. An empty cell keeps what is there; a count from an earlier vacation year goes, and the preview says so.
• *leave-history.csv*: one row per leave: Email, Leave type (Annual leave, Bonus day, Sick leave, Unpaid leave or Other), From, To, and a Comment if you like. It arrives approved, and nobody is notified.
Set up a vacation policy and teams first: a balance needs a policy, and working days come from its holidays.`;

@Injectable()
export class LeaveFileDmService {
  public constructor(
    private readonly templateService: LeaveFileTemplateService,
    private readonly dmFileService: DmFileService,
  ) {}

  public async sendTemplates(user: IUserViewModel) {
    await this.dmFileService.send(user, {
      intro: BALANCES_INTRO,
      title: 'Leave balances',
      filename: 'leave-balances.csv',
      content: await this.templateService.balances(user.slack_team_id),
    });
    await this.dmFileService.send(user, {
      intro: '🗓 And the leave history: one row per leave, taken or agreed.',
      title: 'Leave history',
      filename: 'leave-history.csv',
      content: this.templateService.history(),
    });
  }
}
