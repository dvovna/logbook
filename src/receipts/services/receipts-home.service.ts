import { Injectable } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementOptOutsService } from '@modules/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';
import {
  collectedMonth,
  dueDateOf,
} from '@modules/receipts/utils/receipt-months';

export interface IReceiptsHomeLine {
  reimbursementName: string;
  // The month being collected, as '2026-06-01'.
  month: string;
  count: number;
  totalCents: number;
  dueDate: string;
}

export interface IReceiptsHomeSummary {
  lines: IReceiptsHomeLine[];
  // Receipts the person sent and gave no details yet.
  drafts: number;
  // Every reimbursement's reminders are off for the person.
  remindersOff: boolean;
  // The workspace's, for the amounts.
  currency: string;
}

const COUNTED = [ReceiptStatus.Submitted, ReceiptStatus.Accepted];

@Injectable()
export class ReceiptsHomeService {
  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly reimbursements: ReimbursementsService,
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly slackTeams: SlackTeamsService,
  ) {}

  // Every read at once, so that Home gains no round trip: what is collected
  // is known only from the reimbursements, but it is always last month or
  // this one (due days are 1 to 28), so the receipts of those two months are
  // read beside them and picked afterwards. Null with nothing to collect.
  public async summaryFor(
    user: IUserViewModel,
    today: string,
  ): Promise<IReceiptsHomeSummary | null> {
    const [active, counted, drafts, currency, optedOut] = await Promise.all([
      this.reimbursements.findActive(user.slack_team_id),
      this.receipts.findMany({
        slack_team_id: user.slack_team_id,
        user_id: user.id,
        status: COUNTED,
        month: [
          ...new Set([collectedMonth(today, 1), collectedMonth(today, 28)]),
        ],
      }),
      this.receipts.count({
        slack_team_id: user.slack_team_id,
        user_id: user.id,
        status: ReceiptStatus.Draft,
      }),
      this.slackTeams.getCurrency(user.slack_team_id),
      this.optOuts.findOptedOutIds(user),
    ]);

    if (!active.length) {
      return null;
    }

    const collecting = active
      .filter(({ id }) => !optedOut.includes(id))
      .map((reimbursement) => ({
        reimbursement,
        month: collectedMonth(today, reimbursement.dueDay),
      }));

    return {
      lines: collecting.map(({ reimbursement, month }) => {
        const own = counted.filter(
          (receipt) =>
            receipt.reimbursementId === reimbursement.id &&
            receipt.month === month,
        );

        return {
          reimbursementName: reimbursement.name,
          month,
          count: own.length,
          totalCents: own.reduce(
            (sum, { amountCents }) => sum + (amountCents ?? 0),
            0,
          ),
          dueDate: dueDateOf(month, reimbursement.dueDay),
        };
      }),
      drafts,
      remindersOff: collecting.length === 0,
      currency,
    };
  }
}
