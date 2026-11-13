import { Injectable } from '@nestjs/common';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { RemindersModalView } from '@modules/slack/receipts/views/reminders-modal.view';
import { ReimbursementOptOutsService } from 'src/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';

@Injectable()
export class RemindersModalService {
  public constructor(
    private readonly reimbursements: ReimbursementsService,
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly view: RemindersModalView,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  // Opens nothing when the workspace collects nothing: Home offers no
  // button then.
  public async open(triggerId: string, user: IUserViewModel) {
    const [reimbursements, optedOutIds] = await Promise.all([
      this.reimbursements.findActive(user.slack_team_id),
      this.optOuts.findOptedOutIds(user),
    ]);

    if (!reimbursements.length) {
      return;
    }

    await this.slackCommunicationService.openView(
      triggerId,
      this.view.build({ reimbursements, optedOutIds }),
      user.slack_team_id,
    );
  }
}
