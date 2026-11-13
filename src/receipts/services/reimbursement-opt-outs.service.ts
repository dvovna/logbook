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

  // Of the reimbursements the form showed, the ones the person wants
  // reminders about are opted in and the others out. Anything not shown, not
  // active or not the workspace's is left as it is: a reimbursement created
  // after the form opened was never offered.
  public async setReminded(
    user: IUserViewModel,
    shownReimbursementIds: string[],
    remindedReimbursementIds: string[],
  ): Promise<void> {
    const active = await this.reimbursements.findActive(user.slack_team_id);
    const shown = new Set(shownReimbursementIds);
    const reminded = new Set(remindedReimbursementIds);
    const changed = active.map(({ id }) => id).filter((id) => shown.has(id));

    await this.transactions.transaction(async () => {
      await this.optOuts.add(
        user.slack_team_id,
        user.id,
        changed.filter((id) => !reminded.has(id)),
      );
      await this.optOuts.remove(
        user.slack_team_id,
        user.id,
        changed.filter((id) => reminded.has(id)),
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
