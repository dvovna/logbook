import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
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
}

const COUNTED = [ReceiptStatus.Submitted, ReceiptStatus.Accepted];

@Injectable()
export class ReceiptsHomeService {
  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly reimbursements: ReimbursementsService,
  ) {}

  // Null with nothing to collect, after one read: Home asks everyone.
  public async summaryFor(
    user: IUserViewModel,
    today: string,
  ): Promise<IReceiptsHomeSummary | null> {
    const active = await this.reimbursements.findActive(user.slack_team_id);

    if (!active.length) {
      return null;
    }

    const collecting = active.map((reimbursement) => ({
      reimbursement,
      month: collectedMonth(today, reimbursement.dueDay),
    }));
    const [counted, drafts] = await Promise.all([
      this.receipts.findMany({
        slack_team_id: user.slack_team_id,
        user_id: user.id,
        status: COUNTED,
        reimbursement_id: collecting.map(
          ({ reimbursement }) => reimbursement.id,
        ),
        month: [...new Set(collecting.map(({ month }) => month))],
      }),
      this.receipts.count({
        slack_team_id: user.slack_team_id,
        user_id: user.id,
        status: ReceiptStatus.Draft,
      }),
    ]);

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
    };
  }
}
