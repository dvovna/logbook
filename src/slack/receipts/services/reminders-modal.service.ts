import { MANAGER_ROLES } from '@common/constants/role-groups';
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

  // The receipts part only for a workspace that collects them.
  public async open(triggerId: string, user: IUserViewModel) {
    const [reimbursements, optedOutIds] = await Promise.all([
      this.reimbursements.findActive(user.slack_team_id),
      this.optOuts.findOptedOutIds(user),
    ]);

    await this.slackCommunicationService.openView(
      triggerId,
      this.view.build({
        reimbursements,
        optedOutIds,
        timeReminder: user.time_reminder,
        approves: MANAGER_ROLES.includes(user.role),
      }),
      user.slack_team_id,
    );
  }
}
