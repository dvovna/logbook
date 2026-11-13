import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReimbursementOptOutsRepository } from '@modules/receipts/repositories/reimbursement-opt-outs.repository';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

@Injectable()
export class ReimbursementOptOutsService {
  public constructor(
    private readonly optOuts: ReimbursementOptOutsRepository,
    private readonly reimbursements: ReimbursementsService,
    private readonly transactions: TransactionService,
  ) {}

  public findOptedOutIds(user: IUserViewModel): Promise<string[]> {
    return this.optOuts.findOptedOutIds(user.slack_team_id, user.id);
  }

  public findOptedOutUserIds(
    reimbursementId: string,
    slackTeamId: string,
  ): Promise<string[]> {
    return this.optOuts.findOptedOutUserIds(slackTeamId, reimbursementId);
  }

  public async optOut(
    user: IUserViewModel,
    reimbursementId: string,
  ): Promise<void> {
    const reimbursement = await this.reimbursements.findById(
      reimbursementId,
      user.slack_team_id,
    );

    if (!reimbursement) {
      throw new NotFoundException(`Reimbursement ${reimbursementId} not found`);
    }

    await this.optOuts.add(user.slack_team_id, user.id, [reimbursementId]);
  }

  // The reimbursements the person wants reminders about; every other active
  // one is opted out. An ID that is not an active reimbursement of the
  // workspace is ignored, and the opt-outs of archived ones stay.
  public async setReminded(
    user: IUserViewModel,
    remindedReimbursementIds: string[],
  ): Promise<void> {
    const active = await this.reimbursements.findActive(user.slack_team_id);
    const reminded = new Set(remindedReimbursementIds);
    const activeIds = active.map(({ id }) => id);

    await this.transactions.transaction(async () => {
      await this.optOuts.add(
        user.slack_team_id,
        user.id,
        activeIds.filter((id) => !reminded.has(id)),
      );
      await this.optOuts.remove(
        user.slack_team_id,
        user.id,
        activeIds.filter((id) => reminded.has(id)),
      );
    });
  }

  // For a caller that already runs in a transaction.
  public removeFor(
    userId: string,
    reimbursementId: string,
    slackTeamId: string,
  ): Promise<void> {
    return this.optOuts.remove(slackTeamId, userId, [reimbursementId]);
  }
}
