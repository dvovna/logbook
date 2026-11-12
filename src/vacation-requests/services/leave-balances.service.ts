import { Injectable } from '@nestjs/common';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { LeaveBalancesRepository } from '@modules/vacation-requests/repositories/leave-balances.repository';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import { IFileBalance } from '@modules/vacation-requests/utils/leave-balance.utils';

export interface ILeaveBalanceRestoreParams {
  userId: string;
  uploadId: string;
  // The row's, as the upload left it.
  updatedAt: string;
  // The balance before the upload; null when there was none.
  before: IFileBalance | null;
}

// The balances HR set from a file: one per person, "N left on date D".
@Injectable()
export class LeaveBalancesService {
  public constructor(
    private readonly leaveBalancesRepository: LeaveBalancesRepository,
    private readonly transactions: TransactionService,
  ) {}

  public findOfUser(
    userId: string,
    slackTeamId: string,
  ): Promise<ILeaveBalance | null> {
    return this.leaveBalancesRepository.findOne({
      user_id: userId,
      slack_team_id: slackTeamId,
    });
  }

  public async findOfUsers(
    userIds: string[],
    slackTeamId: string,
  ): Promise<ILeaveBalance[]> {
    if (!userIds.length) {
      return [];
    }

    return this.leaveBalancesRepository.findMany({
      user_id: userIds,
      slack_team_id: slackTeamId,
    });
  }

  // Replaces each person's balance whole, in one statement.
  public async setMany(
    balances: (IFileBalance & { userId: string })[],
    uploadId: string,
    setBy: IUserViewModel,
  ): Promise<ILeaveBalance[]> {
    if (!balances.length) {
      return [];
    }

    const updatedAt = new Date().toISOString();

    return (await this.leaveBalancesRepository.upsert(
      balances.map((balance) => ({
        slack_team_id: setBy.slack_team_id,
        user_id: balance.userId,
        balance_on: balance.balanceOn,
        days_left: balance.daysLeft,
        working_days_left: balance.workingDaysLeft,
        bonus_days_left: balance.bonusDaysLeft,
        upload_id: uploadId,
        set_by: setBy.id,
        updated_at: updatedAt,
      })),
      'user_id',
    )) as ILeaveBalance[];
  }

  // Puts back the balance each person had before an upload, only where the
  // row is still as that upload left it: one set or restored since is kept.
  // Returns the user IDs restored.
  public async restoreMany(
    restores: ILeaveBalanceRestoreParams[],
    slackTeamId: string,
  ): Promise<string[]> {
    if (!restores.length) {
      return [];
    }

    return this.transactions.transaction(async () => [
      ...(await this.leaveBalancesRepository.deleteUnchanged(
        slackTeamId,
        restores.filter(({ before }) => !before),
      )),
      ...(await this.leaveBalancesRepository.restoreUnchanged(
        slackTeamId,
        restores
          .filter(({ before }) => before)
          .map(({ before, ...key }) => ({ ...key, ...before! })),
      )),
    ]);
  }
}
